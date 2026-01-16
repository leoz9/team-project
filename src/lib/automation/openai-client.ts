import { Browser, Page } from 'puppeteer'
import { browserPool, createPage, launchBrowser } from './browser-pool'

export interface InviteProgress {
  current: number
  total: number
  email: string
  status: 'success' | 'failed'
  error?: string
}

export interface InviteMembersOptions {
  role?: 'member' | 'admin'
  delayMs?: number
  onProgress?: (progress: InviteProgress) => void
}

export class OpenAIAutomationClient {
  private browserId?: string
  private browser?: Browser
  private page?: Page
  private isInitialized = false
  private ownsBrowser = false
  private isHeadless = true
  private lastDebugScreenshotPath?: string

  async initialize(options: {
    userDataDir?: string
    headless?: boolean
    usePool?: boolean
  } = {}): Promise<void> {
    if (this.isInitialized) return

    const envHeadless = process.env.OPENAI_AUTOMATION_HEADLESS
    const envInteractive = process.env.OPENAI_AUTOMATION_INTERACTIVE === 'true'
    const headless =
      options.headless ??
      (envHeadless ? envHeadless !== 'false' : !envInteractive)
    this.isHeadless = headless

    const usePool =
      options.usePool ?? (!options.userDataDir && headless)

    if (usePool) {
      const { browserId, browser } = await browserPool.acquire()
      this.browserId = browserId
      this.browser = browser
      this.page = await createPage(browser)
      this.ownsBrowser = false
    } else {
      this.browser = await launchBrowser({
        headless,
        userDataDir: options.userDataDir,
      })
      this.page = await createPage(this.browser)
      this.ownsBrowser = true
    }

    this.isInitialized = true
  }

  async login(email: string, password: string): Promise<boolean> {
    if (!this.page) throw new Error('Client not initialized')

    try {
      // Navigate to OpenAI login page
      await this.page.goto('https://platform.openai.com/login', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      })

      await this.delay(1000)

      // Fill in email
      await this.page.waitForSelector('input[type="email"], input[name="email"]', {
        timeout: 10000,
      })
      await this.page.type('input[type="email"], input[name="email"]', email, {
        delay: 100,
      })

      await this.delay(500)

      // Click continue/next button
      const continueButton = await this.page.$('button[type="submit"]')
      if (continueButton) {
        await continueButton.click()
        await this.delay(2000)
      }

      // Fill in password
      await this.page.waitForSelector(
        'input[type="password"], input[name="password"]',
        { timeout: 10000 }
      )
      await this.page.type(
        'input[type="password"], input[name="password"]',
        password,
        { delay: 100 }
      )

      await this.delay(500)

      // Submit login form
      const submitButton = await this.page.$('button[type="submit"]')
      if (submitButton) {
        await submitButton.click()
      }

      // Wait for navigation after login
      await this.delay(5000)

      // Check if login was successful by looking for dashboard elements
      const currentUrl = this.page.url()
      const isLoggedIn =
        currentUrl.includes('platform.openai.com') &&
        !currentUrl.includes('login')

      if (isLoggedIn) {
        console.log('登录成功，当前 URL:', currentUrl)
      }

      return isLoggedIn
    } catch (error) {
      console.error('Login failed:', error)
      return false
    }
  }

  async loginChatGPT(
    email: string,
    password: string,
    options: { allowManual?: boolean; timeoutMs?: number } = {}
  ): Promise<boolean> {
    if (!this.page) throw new Error('Client not initialized')

    try {
      let automatedFailed = false

      try {
        // Navigate to ChatGPT login page
        await this.page.goto('https://chatgpt.com/auth/login', {
          waitUntil: 'networkidle2',
          timeout: 30000,
        })

        await this.delay(1000)

        // Fill in email
        await this.page.waitForSelector(
          'input[type="email"], input[name="email"]',
          { timeout: 10000 }
        )
        await this.page.type('input[type="email"], input[name="email"]', email, {
          delay: 100,
        })

        await this.delay(500)

        // Try to continue to password step
        const continued = await this.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'))
          const button = buttons.find(btn => {
            const text = (btn.textContent || '').trim().toLowerCase()
            return (
              text.includes('continue') ||
              text.includes('next') ||
              text.includes('继续') ||
              text.includes('下一步')
            )
          })
          if (button) {
            ;(button as HTMLElement).click()
            return true
          }
          return false
        })

        if (!continued) {
          await this.page.keyboard.press('Enter')
        }

        await this.delay(2000)

        // Fill in password
        await this.page.waitForSelector(
          'input[type="password"], input[name="password"]',
          { timeout: 10000 }
        )
        await this.page.type(
          'input[type="password"], input[name="password"]',
          password,
          { delay: 100 }
        )

        await this.delay(500)

        // Submit login form
        const submitClicked = await this.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'))
          const button = buttons.find(btn => {
            const text = (btn.textContent || '').trim().toLowerCase()
            return (
              text.includes('continue') ||
              text.includes('log in') ||
              text.includes('sign in') ||
              text.includes('登录') ||
              text.includes('继续')
            )
          })
          if (button) {
            ;(button as HTMLElement).click()
            return true
          }
          return false
        })

        if (!submitClicked) {
          const submitButton = await this.page.$('button[type="submit"]')
          if (submitButton) {
            await submitButton.click()
          } else {
            await this.page.keyboard.press('Enter')
          }
        }

        // Wait for navigation after login
        await this.delay(5000)

        await this.page.goto('https://chatgpt.com/', {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        })

        await this.delay(2000)

        if (await this.isChatGPTLoggedIn()) {
          return true
        }
      } catch (error) {
        console.error('ChatGPT automated login failed:', error)
        automatedFailed = true
      }

      if (options.allowManual && !this.isHeadless) {
        console.log('等待用户手动完成登录...')
        await this.page.goto('https://chatgpt.com/', {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        })
        await this.page.bringToFront()
        await this.page.evaluate((accountEmail) => {
          const existing = document.getElementById('automation-login-hint')
          if (existing) {
            existing.remove()
          }
          const hint = document.createElement('div')
          hint.id = 'automation-login-hint'
          hint.style.position = 'fixed'
          hint.style.top = '12px'
          hint.style.left = '12px'
          hint.style.right = '12px'
          hint.style.zIndex = '2147483647'
          hint.style.background = '#fff8e1'
          hint.style.color = '#1f2937'
          hint.style.border = '1px solid #f59e0b'
          hint.style.borderRadius = '8px'
          hint.style.padding = '12px 16px'
          hint.style.fontSize = '14px'
          hint.style.fontFamily = 'system-ui, -apple-system, Segoe UI, sans-serif'
          hint.textContent =
            `请在此窗口手动登录 ChatGPT（邮箱：${accountEmail}），完成验证码/2FA 后保持页面打开。系统会自动检测登录状态。`
          document.body.appendChild(hint)
        }, email)

        const timeoutMs = options.timeoutMs ?? 8 * 60 * 1000
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
          if (await this.isChatGPTLoggedIn()) {
            return true
          }
          await this.delay(2000)
        }
      }

      if (automatedFailed) {
        return false
      }

      return await this.isChatGPTLoggedIn()
    } catch (error) {
      console.error('ChatGPT login failed:', error)
      return false
    }
  }

  async isChatGPTLoggedIn(): Promise<boolean> {
    if (!this.page) throw new Error('Client not initialized')

    try {
      await this.page.waitForSelector('body', { timeout: 10000 })

      const isLoggedIn = await this.page.evaluate(() => {
        const url = window.location.href
        if (
          url.includes('/auth/login') ||
          url.includes('/login') ||
          url.includes('/auth')
        ) {
          return false
        }

        const emailInput = document.querySelector(
          'input[type="email"], input[name="email"], input[autocomplete="username"]'
        )
        if (emailInput) {
          return false
        }

        const modalHeading = Array.from(
          document.querySelectorAll('h1, h2, h3, h4')
        ).some(el => {
          const text = (el.textContent || '').trim().toLowerCase()
          return text.includes('log in or sign up')
        })
        if (modalHeading) {
          return false
        }

        const elements = Array.from(document.querySelectorAll('a, button'))
        const hasLoginProviders = elements.some(el => {
          const text = (el.textContent || '').trim().toLowerCase()
          return (
            text.includes('continue with google') ||
            text.includes('continue with apple') ||
            text.includes('continue with microsoft') ||
            text.includes('continue with phone') ||
            text.includes('log in') ||
            text.includes('sign in')
          )
        })

        return !hasLoginProviders
      })

      return isLoggedIn
    } catch (error) {
      console.error('Failed to detect ChatGPT login status:', error)
      return false
    }
  }

  getLastDebugScreenshotPath(): string | undefined {
    return this.lastDebugScreenshotPath
  }

  async captureDebugScreenshot(prefix: string): Promise<string | undefined> {
    if (!this.page) return undefined
    try {
      const screenshotPath = `/tmp/${prefix}-${Date.now()}.png`
      await this.page.screenshot({ path: screenshotPath, fullPage: true })
      this.lastDebugScreenshotPath = screenshotPath
      return screenshotPath
    } catch {
      return undefined
    }
  }

  private async isChatGPTWorkspaceModalOpen(): Promise<boolean> {
    if (!this.page) throw new Error('Client not initialized')

    try {
      return await this.page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]')
        if (!dialog) return false
        const text = (dialog.textContent || '').toLowerCase()
        return (
          text.includes('select a workspace') ||
          (text.includes('workspace') && text.includes('select')) ||
          (text.includes('工作空间') && (text.includes('选择') || text.includes('选取')))
        )
      })
    } catch {
      return false
    }
  }

  async ensureChatGPTWorkspaceSelected(options: { maxAttempts?: number } = {}): Promise<boolean> {
    if (!this.page) throw new Error('Client not initialized')
    const page = this.page
    const maxAttempts = options.maxAttempts ?? 3

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const open = await this.isChatGPTWorkspaceModalOpen()
      if (!open) return true

      console.log('检测到工作空间选择弹窗，尝试选择非 Personal account 工作空间...')

      const dialog = await page.$('[role="dialog"]')
      if (!dialog) return true

      const candidates = await dialog.$$(
        'button, [role="button"], [role="option"], [role="menuitem"], li, a'
      )

      let clicked = false
      for (const el of candidates) {
        const info = await el.evaluate((node) => {
          const text = (node.textContent || '').replace(/\s+/g, ' ').trim()
          const lower = text.toLowerCase()
          const ariaDisabled = node.getAttribute('aria-disabled') === 'true'
          const disabled = (node as HTMLButtonElement).disabled || ariaDisabled
          const rect = node.getBoundingClientRect()
          const style = window.getComputedStyle(node)
          const visible =
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            style.pointerEvents !== 'none'
          return { text, lower, disabled, visible }
        })

        if (!info.visible || info.disabled) continue
        if (!info.text) continue

        // Skip personal account entries
        if (
          info.lower.includes('personal account') ||
          info.lower === 'personal' ||
          info.lower.includes('个人')
        ) {
          continue
        }

        try {
          await el.click({ delay: 30 })
          console.log(`已选择工作空间: ${info.text}`)
          clicked = true
          break
        } catch {
          continue
        }
      }

      if (!clicked) {
        console.log('未能在弹窗中找到可点击的工作空间选项')
        return false
      }

      const closed = await page
        .waitForFunction(() => !document.querySelector('[role="dialog"]'), {
          timeout: 15000,
        })
        .then(() => true)
        .catch(() => false)

      if (closed) {
        await this.delay(500)
        continue
      }

      await this.delay(1000)
    }

    return !(await this.isChatGPTWorkspaceModalOpen())
  }

  async selectWorkspace(): Promise<boolean> {
    if (!this.page) throw new Error('Client not initialized')

    try {
      console.log('开始选择工作空间...')
      await this.delay(2000)

      // 检查是否有工作空间选择器
      const possibleSelectors = [
        'button:has-text("工作空间")',
        'button:has-text("Workspace")',
        '[data-testid="workspace-selector"]',
        '[aria-label*="workspace" i]',
        '[aria-label*="organization" i]',
        'button[class*="workspace"]',
        'button[class*="organization"]',
        // 下拉菜单相关
        'select[name="organization"]',
        '[role="combobox"]',
      ]

      let selectorFound = false
      for (const selector of possibleSelectors) {
        try {
          const element = await this.page.$(selector)
          if (element) {
            console.log(`找到工作空间选择器: ${selector}`)
            await element.click()
            await this.delay(1000)
            selectorFound = true
            break
          }
        } catch (e) {
          continue
        }
      }

      if (!selectorFound) {
        console.log('未找到工作空间选择器，尝试在页面中查找工作空间相关文本')

        // 尝试通过文本内容查找
        const pageText = await this.page.evaluate(() => document.body.innerText)
        console.log('页面文本片段:', pageText.substring(0, 500))
      }

      // 查找工作空间列表项（排除个人账户）
      const workspaceSelectors = [
        '[role="option"]',
        '[role="menuitem"]',
        'li[class*="workspace"]',
        'div[class*="organization"]',
        'button[class*="org"]',
      ]

      await this.delay(1000)

      for (const selector of workspaceSelectors) {
        try {
          const items = await this.page.$$(selector)
          console.log(`找到 ${items.length} 个选项使用选择器: ${selector}`)

          for (const item of items) {
            const text = await item.evaluate(el => el.textContent || '')
            console.log('选项文本:', text)

            // 排除个人账户，选择第一个非个人的工作空间
            if (
              !text.includes('Personal') &&
              !text.includes('个人') &&
              text.trim().length > 0
            ) {
              console.log('选择工作空间:', text)
              await item.click()
              await this.delay(2000)
              return true
            }
          }
        } catch (e) {
          continue
        }
      }

      console.log('未找到可选择的工作空间，可能已经在正确的工作空间中')
      return true
    } catch (error) {
      console.error('选择工作空间失败:', error)
      return false
    }
  }

  async navigateToTeamSettings(teamId?: string): Promise<boolean> {
    if (!this.page) throw new Error('Client not initialized')

    try {
      const url = teamId
        ? `https://platform.openai.com/settings/organization/${teamId}/members`
        : 'https://platform.openai.com/settings/organization/members'

      await this.page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      })

      await this.delay(2000)

      return true
    } catch (error) {
      console.error('Failed to navigate to team settings:', error)
      return false
    }
  }

  async navigateToChatGPTMembers(tab: 'members' | 'pending-invites' | 'pending-requests' = 'members'): Promise<boolean> {
    if (!this.page) throw new Error('Client not initialized')

    const tabParam =
      tab === 'members' ? 'members' : tab === 'pending-invites' ? 'invites' : 'requests'

    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        await this.page.goto(`https://chatgpt.com/admin/members?tab=${tabParam}`, {
          waitUntil: 'networkidle2',
          timeout: 30000,
        })

        await this.delay(1000)

        const workspaceOk = await this.ensureChatGPTWorkspaceSelected()
        if (!workspaceOk) {
          const screenshotPath = await this.captureDebugScreenshot(
            'workspace-select-failed'
          )
          console.log(
            `选择工作空间失败${screenshotPath ? `，截图已保存: ${screenshotPath}` : ''}`
          )
          return false
        }

        await this.delay(1000)

        if (this.page.url().includes('/admin/members')) {
          await this.delay(1000)
          return true
        }
      }

      return this.page.url().includes('/admin/members')
    } catch (error) {
      console.error('Failed to navigate to ChatGPT members:', error)
      return false
    }
  }

  async getChatGPTMemberCountHint(): Promise<number | null> {
    if (!this.page) throw new Error('Client not initialized')

    try {
      await this.page.waitForSelector('body', { timeout: 10000 })

      const count = await this.page.evaluate(() => {
        const rootText = (document.querySelector('main')?.innerText || document.body.innerText || '')
        const lines = rootText
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean)

        // Prefer a line like "Business - 3 members"
        for (const line of lines) {
          const match = line.match(/[-–—]\s*(\d+)\s+members?/i)
          if (match) return Number(match[1])
        }

        // Fallback: any "X members" on the page
        for (const line of lines) {
          const match = line.match(/(\d+)\s+members?/i)
          if (match) return Number(match[1])
        }

        return null
      })

      return typeof count === 'number' && Number.isFinite(count) ? count : null
    } catch (error) {
      console.error('Failed to read ChatGPT member count hint:', error)
      return null
    }
  }

  async getChatGPTMemberEmails(options: { excludeEmail?: string } = {}): Promise<string[]> {
    if (!this.page) throw new Error('Client not initialized')

    try {
      await this.page.waitForSelector('main', { timeout: 15000 })
      await this.delay(1500)

      const emails = await this.page.evaluate(() => {
        const text =
          (document.querySelector('main')?.innerText || document.body.innerText || '')

        const emailRegex = /[\w.+-]+@[\w.-]+\.\w+/g
        const matches = text.match(emailRegex) || []

        const filtered = matches.filter(email => {
          const lower = email.toLowerCase()
          return (
            !lower.includes('noreply') &&
            !lower.includes('no-reply') &&
            !lower.includes('support') &&
            !lower.includes('example.com')
          )
        })

        return Array.from(new Set(filtered))
      })

      const exclude = options.excludeEmail?.toLowerCase()
      return (emails as string[]).filter(e => (exclude ? e.toLowerCase() !== exclude : true))
    } catch (error) {
      console.error('Failed to get ChatGPT member emails:', error)
      return []
    }
  }

  async inviteMember(
    email: string,
    role: 'member' | 'admin' = 'member'
  ): Promise<boolean> {
    if (!this.page) throw new Error('Client not initialized')
    const page = this.page

    try {
      console.log(`开始邀请成员: ${email}`)

      // 等待页面完全加载
      await this.delay(2000)

      const currentUrl = page.url()
      if (!currentUrl.includes('/admin/members')) {
        const recovered = await this.navigateToChatGPTMembers('members')
        if (recovered) {
          await this.delay(1000)
        }

        const recoveredUrl = page.url()
        if (recoveredUrl.includes('/admin/members')) {
          console.log('已恢复到成员管理页面，继续邀请流程')
        } else {
          const screenshotPath = `/tmp/invite-wrong-page-${Date.now()}.png`
          await page.screenshot({ path: screenshotPath, fullPage: true })
          throw new Error(
          `未处于成员管理页面，当前URL: ${recoveredUrl}，截图: ${screenshotPath}`
          )
        }
      }

      // 尝试通过多种方式查找邀请按钮
      console.log('查找邀请按钮...')
      const buttonFound = await page.evaluate(() => {
        // 方法1: 查找所有可能的可点击元素
        const allClickable = Array.from(document.querySelectorAll(
          'button, div[role="button"], a, div[class*="cursor-pointer"]'
        ))

        // 方法2: 查找包含特定文本的元素
        let inviteElement = allClickable.find(el => {
          const text = el.textContent?.trim() || ''
          return text.includes('邀请成员') ||
                 text.includes('Invite member') ||
                 text.includes('Invite')
        })

        // 方法3: 如果还没找到，查找包含特定class的div
        if (!inviteElement) {
          const divs = Array.from(document.querySelectorAll('div.flex'))
          inviteElement = divs.find(el => {
            const text = el.textContent?.trim() || ''
            return text.includes('邀请') || text.includes('Invite')
          })
        }

        // 方法4: 查找父元素（因为用户提供的是子div）
        if (!inviteElement) {
          const allDivs = Array.from(document.querySelectorAll('div'))
          const targetDiv = allDivs.find(el => {
            const text = el.textContent?.trim() || ''
            const hasIcon = el.querySelector('svg') !== null
            return hasIcon && (text.includes('邀请成员') || text.includes('Invite'))
          })
          if (targetDiv) {
            // 尝试找到可点击的父元素
            let parent = targetDiv.parentElement
            while (parent) {
              if (parent.tagName === 'BUTTON' || parent.getAttribute('role') === 'button') {
                inviteElement = parent
                break
              }
              parent = parent.parentElement
            }
            // 如果没有找到button父元素，就点击这个div本身
            if (!inviteElement) {
              inviteElement = targetDiv
            }
          }
        }

        if (inviteElement) {
          console.log('找到邀请按钮，准备点击')
          ;(inviteElement as HTMLElement).click()
          return true
        }

        return false
      })

      if (!buttonFound) {
        // 保存截图帮助调试
        const screenshotPath = `/tmp/invite-error-${Date.now()}.png`
        await page.screenshot({ path: screenshotPath, fullPage: true })
        console.log(`未找到邀请按钮，截图已保存: ${screenshotPath}`)
        throw new Error('找不到邀请按钮')
      }

      console.log('成功点击邀请按钮')
      await this.delay(2000)

      const emailInputReady = await page.waitForFunction(() => {
        const input = document.querySelector(
          'input[type="email"], input[name="email"], input[placeholder*="email" i], input[placeholder*="邮箱" i]'
        ) as HTMLInputElement | null
        if (!input) return false
        const style = window.getComputedStyle(input)
        return style && style.visibility !== 'hidden' && style.display !== 'none'
      }, { timeout: 5000 }).then(() => true).catch(() => false)

      if (!emailInputReady) {
        throw new Error('邀请弹窗未出现或邮箱输入框不可见')
      }

      // 查找邮箱输入框
      console.log('查找邮箱输入框...')
      const emailInputSelectors = [
        'input[type="email"]',
        'input[placeholder*="email" i]',
        'input[placeholder*="邮箱" i]',
        'input[name="email"]',
        'input[id*="email" i]',
      ]

      let emailEntered = false
      for (const selector of emailInputSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 3000 })
          await page.click(selector)
          await page.type(selector, email, { delay: 100 })
          console.log(`成功输入邮箱到: ${selector}`)
          emailEntered = true
          break
        } catch (e) {
          continue
        }
      }

      if (!emailEntered) {
        throw new Error('找不到邮箱输入框')
      }

      await this.delay(500)
      await page.keyboard.press('Enter')
      await this.delay(500)

      // Select role if needed
      if (role === 'admin') {
        // 尝试查找角色选择器
        console.log('尝试选择管理员角色...')
        try {
          const roleSelectors = [
            'select[name="role"]',
            'button:has-text("管理员")',
            'button:has-text("Admin")',
          ]
          for (const selector of roleSelectors) {
            try {
              await page.waitForSelector(selector, { timeout: 2000 })
              await page.click(selector)
              break
            } catch (e) {
              continue
            }
          }
        } catch (e) {
          console.log('未找到角色选择器，使用默认角色')
        }
      }

      const clickButtonByText = async (
        labels: string[],
        timeoutMs: number,
        scope: 'dialog' | 'page' = 'dialog'
      ): Promise<boolean> => {
        const start = Date.now()
        const candidates = labels.map(l => l.toLowerCase())

        while (Date.now() - start < timeoutMs) {
          const root =
            scope === 'dialog'
              ? await page.$('[role="dialog"]')
              : null

          const handles = root
            ? await root.$$(
                'button, [role="button"], [role="tab"], a'
              )
            : await page.$$(
                'button, [role="button"], [role="tab"], a'
              )

          for (const handle of handles) {
            const info = await handle.evaluate(el => {
              const text = (el.textContent || '').trim().toLowerCase()
              const ariaDisabled = el.getAttribute('aria-disabled') === 'true'
              const disabled = (el as HTMLButtonElement).disabled || ariaDisabled
              const rect = el.getBoundingClientRect()
              const style = window.getComputedStyle(el)
              const visible =
                rect.width > 0 &&
                rect.height > 0 &&
                style.visibility !== 'hidden' &&
                style.display !== 'none' &&
                style.pointerEvents !== 'none'
              return { text, disabled, visible }
            })

            if (!info.visible || info.disabled) continue

            const matched = candidates.some(label =>
              info.text === label || info.text.includes(label)
            )
            if (!matched) continue

            try {
              await handle.click({ delay: 30 })
              return true
            } catch {
              continue
            }
          }

          await this.delay(250)
        }

        return false
      }

      const nextClicked = await clickButtonByText(['next', '下一步'], 3000)
      if (nextClicked) {
        console.log('检测到 Next，已点击')
        await this.delay(1500)
      }

      // 查找并点击提交按钮
      console.log('查找提交按钮...')
      const responsePromise = page
        .waitForResponse(
          (res) => {
            const method = res.request().method()
            const resourceType = res.request().resourceType()
            if (method !== 'POST') return false
            if (resourceType !== 'xhr' && resourceType !== 'fetch') return false
            const url = res.url().toLowerCase()
            return (
              url.includes('chatgpt.com') &&
              (url.includes('invite') || url.includes('invitation') || url.includes('invit'))
            )
          },
          { timeout: 15000 }
        )
        .catch(() => null)

      const submitted = await clickButtonByText(
        [
          'send email',
          'send invite',
          'send invites',
          'invite',
          '发送邀请',
          '邀请',
          '确定',
          'ok',
        ],
        5000
      )
      if (!submitted) {
        throw new Error('找不到提交按钮')
      }

      await this.delay(300)

      const sendButtonStillClickable = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]')
        if (!dialog) return false
        const buttons = Array.from(dialog.querySelectorAll('button, [role="button"]'))
        const target = buttons.find(btn => {
          const text = (btn.textContent || '').trim().toLowerCase()
          return text.includes('send invites') || text.includes('send invite') || text.includes('send email')
        }) as HTMLButtonElement | null
        if (!target) return false
        const ariaDisabled = target.getAttribute('aria-disabled') === 'true'
        const disabled = (target as HTMLButtonElement).disabled || ariaDisabled
        return !disabled
      })

      if (sendButtonStillClickable) {
        console.log('提交按钮仍可点击，尝试再次点击以触发提交')
        await clickButtonByText(
          ['send invites', 'send invite', 'send email', '邀请', '发送邀请'],
          2000
        )
      }

      let inviteResponse = await responsePromise
      if (!inviteResponse) {
        const fallbackPromise = page
          .waitForResponse(
            (res) => {
              const method = res.request().method()
              const resourceType = res.request().resourceType()
              if (method !== 'POST') return false
              if (resourceType !== 'xhr' && resourceType !== 'fetch') return false
              const url = res.url().toLowerCase()
              return url.includes('chatgpt.com')
            },
            { timeout: 8000 }
          )
          .catch(() => null)

        inviteResponse = await fallbackPromise
      }

      if (inviteResponse) {
        const status = inviteResponse.status()
        console.log(`检测到POST请求响应: ${status} ${inviteResponse.url()}`)
        if (status >= 400) {
          const body = await inviteResponse.text().catch(() => '')
          throw new Error(`邀请请求失败: ${status} ${inviteResponse.url()} ${body ? `- ${body.slice(0, 300)}` : ''}`)
        }
      } else {
        console.log('未捕获到POST请求响应（可能是前端未发起请求或请求被拦截）')
      }

      await this.delay(2000)

      const dialogClosed = await page
        .waitForFunction(() => {
          const dialog = document.querySelector('[role="dialog"]')
          return !dialog
        }, { timeout: 5000 })
        .then(() => true)
        .catch(() => false)

      if (!dialogClosed) {
        await page.keyboard.press('Escape').catch(() => {})
        await this.delay(500)
        const ariaCloseClicked = await page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]')
          if (!dialog) return false
          const closeButton =
            dialog.querySelector('button[aria-label*="close" i]') ||
            dialog.querySelector('[role="button"][aria-label*="close" i]')
          if (closeButton) {
            ;(closeButton as HTMLElement).click()
            return true
          }
          return false
        })
        if (ariaCloseClicked) {
          await this.delay(500)
        }
        await this.delay(1500)
      }

      const pendingTabClicked = await clickButtonByText(
        ['pending invites', '邀请中', '待处理邀请'],
        3000,
        'page'
      )
      if (pendingTabClicked) {
        await this.delay(1500)
      }

      const inviteConfirmed = await page.waitForFunction(
        (targetEmail: string) => {
          const dialog = document.querySelector('[role="dialog"]')
          if (dialog) return false

          const text = (document.querySelector('main')?.innerText || document.body.innerText || '')
          const lower = text.toLowerCase()
          if (lower.includes(targetEmail.toLowerCase())) return true

          return (
            lower.includes('invitation sent') ||
            lower.includes('invite sent') ||
            lower.includes('已发送邀请') ||
            lower.includes('邀请已发送')
          )
        },
        { timeout: 20000 },
        email
      ).then(() => true).catch(() => false)

      if (!inviteConfirmed) {
        if (inviteResponse) {
          console.log('邀请请求已返回成功，尝试刷新页面确认结果...')
          await page.goto('https://chatgpt.com/admin/members', {
            waitUntil: 'networkidle2',
            timeout: 30000,
          })
          await this.delay(2000)
          await clickButtonByText(
            ['pending invites', '邀请中', '待处理邀请'],
            3000,
            'page'
          )
          await this.delay(2000)

          const refreshedConfirmed = await page.evaluate((targetEmail) => {
            const text = (document.body.innerText || '').toLowerCase()
            return text.includes(targetEmail.toLowerCase())
          }, email)

          if (refreshedConfirmed) {
            console.log('刷新后在页面中检测到邮箱，认为邀请成功')
            console.log(`成功邀请成员: ${email}`)
            return true
          }
        }

        const screenshotPath = `/tmp/invite-unconfirmed-${Date.now()}.png`
        await page.screenshot({ path: screenshotPath, fullPage: true })
        console.log(`未检测到邀请结果，截图已保存: ${screenshotPath}`)
        if (inviteResponse) {
          throw new Error('邀请请求已返回成功，但页面仍未检测到列表更新（可能需要手动刷新或该邮箱已存在邀请）')
        }
        throw new Error('提交邀请后未检测到成功提示或列表更新')
      }

      console.log(`成功邀请成员: ${email}`)
      return true
    } catch (error) {
      console.error(`邀请成员失败 (${email}):`, error)
      return false
    }
  }

  async inviteMembers(
    emails: string[],
    options: InviteMembersOptions = {}
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    const { role = 'member', delayMs = 3000, onProgress } = options

    let success = 0
    let failed = 0
    const errors: string[] = []

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i]

      try {
        const result = await this.inviteMember(email, role)

        if (result) {
          success++
          onProgress?.({
            current: i + 1,
            total: emails.length,
            email,
            status: 'success',
          })
        } else {
          failed++
          const error = `Failed to invite ${email}`
          errors.push(error)
          onProgress?.({
            current: i + 1,
            total: emails.length,
            email,
            status: 'failed',
            error,
          })
        }
      } catch (error) {
        failed++
        const errorMsg = `Error inviting ${email}: ${error}`
        errors.push(errorMsg)
        onProgress?.({
          current: i + 1,
          total: emails.length,
          email,
          status: 'failed',
          error: errorMsg,
        })
      }

      // Delay between invitations to avoid rate limiting
      if (i < emails.length - 1) {
        await this.delay(delayMs)
      }
    }

    return { success, failed, errors }
  }

  async getMembers(): Promise<string[]> {
    if (!this.page) throw new Error('Client not initialized')

    try {
      // 等待页面加载完成
      await this.delay(2000)

      // 尝试多种方法获取成员列表
      const members: string[] = []

      // 方法1: 在页面内容中查找所有邮箱格式的文本
      const pageText = await this.page.evaluate(() => document.body.innerText)
      const emailRegex = /[\w.-]+@[\w.-]+\.\w+/g
      const emailMatches = pageText.match(emailRegex) || []

      // 过滤掉常见的非成员邮箱
      const filteredEmails = emailMatches.filter(email =>
        !email.includes('noreply') &&
        !email.includes('support') &&
        !email.includes('no-reply')
      )

      // 去重
      const uniqueEmails = [...new Set(filteredEmails)]
      members.push(...uniqueEmails)

      console.log('找到的成员邮箱:', members)

      // 方法2: 尝试特定的选择器（OpenAI 可能使用的结构）
      const possibleSelectors = [
        'table tbody tr',  // 表格行
        '[role="row"]',    // ARIA 表格行
        '[data-member-email]',
        '.member-row',
        '[class*="MemberRow"]',
        '[class*="member"]'
      ]

      for (const selector of possibleSelectors) {
        try {
          const elements = await this.page.$$(selector)
          if (elements.length > 0) {
            console.log(`找到 ${elements.length} 个元素使用选择器: ${selector}`)

            for (const element of elements) {
              const text = await element.evaluate((el) => el.textContent || '')
              const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/)
              if (emailMatch && !members.includes(emailMatch[0])) {
                members.push(emailMatch[0])
              }
            }
          }
        } catch (e) {
          // 忽略选择器错误，继续尝试下一个
          continue
        }
      }

      // 再次去重
      const finalMembers = [...new Set(members)].filter(email =>
        !email.includes('noreply') &&
        !email.includes('support') &&
        !email.includes('no-reply')
      )

      console.log('最终成员列表:', finalMembers)
      return finalMembers
    } catch (error) {
      console.error('Failed to get members:', error)
      return []
    }
  }

  async close(): Promise<void> {
    if (this.page) {
      await this.page.close()
      this.page = undefined
    }

    if (this.ownsBrowser && this.browser) {
      await this.browser.close()
      this.browser = undefined
      this.ownsBrowser = false
      this.browserId = undefined
    } else if (this.browserId) {
      browserPool.release(this.browserId)
      this.browserId = undefined
    }

    this.browser = undefined
    this.isInitialized = false
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
