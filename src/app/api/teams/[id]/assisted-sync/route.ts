import { NextRequest, NextResponse } from 'next/server'
import { teamService } from '@/lib/services/team.service'
import { decrypt } from '@/lib/utils/crypto'
import { createVisibleBrowser } from '@/lib/automation/assisted-login'
import prisma from '@/lib/prisma'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const teamId = params.id

    const team = await teamService.getTeamById(teamId)
    if (!team) {
      return NextResponse.json(
        { success: false, message: '团队不存在' },
        { status: 404 }
      )
    }

    // 获取解密的密码
    const password = decrypt(team.password)

    // 创建可见浏览器
    console.log('打开浏览器窗口...')
    const browser = await createVisibleBrowser()
    const page = await browser.newPage()

    try {
      // 尝试加载已保存的cookies
      let needsLogin = true
      if (team.cookies) {
        try {
          console.log('步骤1: 尝试使用已保存的登录信息...')
          const cookies = JSON.parse(team.cookies)
          await page.setCookie(...cookies)

          // 访问ChatGPT检查是否已登录
          await page.goto('https://chatgpt.com/', {
            waitUntil: 'networkidle2',
            timeout: 30000,
          })

          await new Promise(resolve => setTimeout(resolve, 2000))

          // 检查是否已登录（如果URL不包含login，说明已登录）
          const currentUrl = page.url()
          if (!currentUrl.includes('login') && !currentUrl.includes('auth')) {
            console.log('使用已保存的登录信息成功！')
            needsLogin = false
          } else {
            console.log('已保存的登录信息已过期，需要重新登录')
          }
        } catch (error) {
          console.log('加载cookies失败，需要重新登录:', error)
        }
      }

      // 如果需要登录，提示用户手动登录
      if (needsLogin) {
        console.log('步骤1: 打开 ChatGPT.com...')
        await page.goto('https://chatgpt.com/', {
          waitUntil: 'networkidle2',
          timeout: 30000,
        })

        await new Promise(resolve => setTimeout(resolve, 2000))

        console.log('步骤2: 等待用户手动登录...')
        await page.evaluate((email) => {
          alert(`请在此浏览器窗口中手动完成以下操作：\n\n1. 点击"Log in"登录\n2. 输入邮箱：${email}\n3. 输入密码\n4. 完成登录（包括验证码、2FA 等）\n5. 选择正确的工作空间（Team）\n\n完成后点击"确定"，系统将自动提取成员信息`)
        }, team.email)

        await new Promise(resolve => setTimeout(resolve, 2000))

        // 保存新的cookies
        const newCookies = await page.cookies()
        await prisma.team.update({
          where: { id: teamId },
          data: {
            cookies: JSON.stringify(newCookies),
          },
        })
        console.log('已保存新的登录信息')
      }

      // 自动导航到成员管理页面
      console.log('步骤3: 导航到成员管理页面...')
      await page.goto('https://chatgpt.com/admin/members?tab=members', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      })

      await new Promise(resolve => setTimeout(resolve, 3000))

      console.log('步骤4: 开始自动提取成员...')

      console.log('步骤7: 提取成员列表/成员数...')
      const memberInfo = await page.evaluate((adminEmail) => {
        const mainText =
          (document.querySelector('main')?.innerText || document.body.innerText || '')

        const emailRegex = /[\w.+-]+@[\w.-]+\.\w+/g
        const emailMatches = mainText.match(emailRegex) || []

        const filteredEmails = emailMatches.filter(email => {
          const lower = email.toLowerCase()
          return (
            !lower.includes('noreply') &&
            !lower.includes('support') &&
            !lower.includes('no-reply') &&
            !lower.includes('example.com')
          )
        })

        const uniqueEmails = Array.from(new Set(filteredEmails))
        const finalEmails = uniqueEmails.filter(
          email => email.toLowerCase() !== adminEmail.toLowerCase()
        )

        const countHintMatch = mainText.match(/(\d+)\s+members?/i)
        const countHint = countHintMatch ? Number(countHintMatch[1]) : null

        return {
          emails: finalEmails,
          countHint,
        }
      }, team.email)

      const finalMembers = memberInfo.emails
      let memberCount = finalMembers.length
      if (typeof memberInfo.countHint === 'number') {
        memberCount = memberInfo.countHint
      }

      console.log('排除管理员后的成员:', finalMembers)
      console.log('成员数:', memberCount)

      // 截图保存
      const screenshotPath = `/tmp/members-sync-${Date.now()}.png`
      await page.screenshot({ path: screenshotPath, fullPage: true })
      console.log('截图已保存到:', screenshotPath)

      // 最终确认，给用户选择是否关闭浏览器
      const shouldClose = await page.evaluate((memberCount) => {
        return confirm(
          `成员信息提取完成！\n\n找到 ${memberCount} 个成员\n\n点击"确定"关闭浏览器并完成同步\n点击"取消"保持浏览器打开（需手动关闭）`
        )
      }, memberCount)

      if (shouldClose) {
        // 关闭浏览器
        await browser.close()
      } else {
        // 不关闭浏览器，给用户提示
        console.log('浏览器保持打开状态，用户可以继续检查')
        // 注意：这种情况下浏览器不会关闭，需要用户手动关闭
      }

      // 更新数据库
      await prisma.team.update({
        where: { id: teamId },
        data: {
          memberCount: memberCount,
          lastSyncAt: new Date(),
        },
      })

      return NextResponse.json({
        success: true,
        count: memberCount,
        members: finalMembers,
        message: `同步成功！成员数（含账号）：${memberCount}`,
        screenshotPath,
      })

    } catch (error) {
      // 出错时询问是否关闭浏览器
      try {
        const shouldClose = await page.evaluate(() => {
          return confirm('操作过程中出现错误\n\n点击"确定"关闭浏览器\n点击"取消"保持浏览器打开以便检查问题')
        })

        if (shouldClose) {
          await browser.close()
        }
      } catch (e) {
        // 如果无法询问用户，就直接关闭
        await browser.close()
      }
      throw error
    }

  } catch (error) {
    console.error('半自动化同步失败:', error)
    return NextResponse.json(
      {
        success: false,
        message: `同步失败: ${error instanceof Error ? error.message : '未知错误'}`,
      },
      { status: 500 }
    )
  }
}
