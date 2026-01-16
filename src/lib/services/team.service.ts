import prisma from '@/lib/prisma'
import { encrypt, decrypt } from '@/lib/utils/crypto'
import { CreateTeamInput, UpdateTeamInput } from '@/lib/utils/validation'
import { Team } from '@prisma/client'
import { OpenAIAutomationClient } from '@/lib/automation/openai-client'
import { promises as fs } from 'fs'
import path from 'path'

export class TeamService {
  private getProfileDir(teamId: string): string {
    return path.join(process.cwd(), '.automation-profiles', teamId)
  }

  async isLoginInitialized(teamId: string): Promise<boolean> {
    try {
      await fs.access(this.getProfileDir(teamId))
      return true
    } catch {
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: { cookies: true },
      })
      return Boolean(team?.cookies)
    }
  }

  async checkTeamLogin(id: string): Promise<{
    success: boolean
    initialized: boolean
    loggedIn: boolean
    memberCount?: number
    memberLimit?: number
    seatsRemaining?: number
    memberCountExcludingOwner?: number
    message: string
    checkedAt: string
  }> {
    const team = await prisma.team.findUnique({ where: { id } })
    if (!team) {
      return {
        success: false,
        initialized: false,
        loggedIn: false,
        message: 'Team not found',
        checkedAt: new Date().toISOString(),
      }
    }

    const initialized = await this.isLoginInitialized(id)
    if (!initialized) {
      const now = new Date()
      await prisma.team.update({
        where: { id },
        data: {
          status: 'inactive',
          lastLoginCheckAt: now,
          loginError: 'Not initialized',
        },
      })

      return {
        success: true,
        initialized: false,
        loggedIn: false,
        message: '未初始化登录，请先点击“初始化登录”',
        checkedAt: now.toISOString(),
      }
    }

    const profileDir = this.getProfileDir(id)
    await fs.mkdir(profileDir, { recursive: true })

    const client = new OpenAIAutomationClient()
    await client.initialize({ userDataDir: profileDir })

    try {
      const page = (client as any).page
      if (page) {
        await page.goto('https://chatgpt.com/', {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        })
      }

      const loggedIn = await client.isChatGPTLoggedIn()
      const now = new Date()

      const memberLimit = Number(process.env.CHATGPT_MEMBER_LIMIT || 5)
      let memberCount: number | undefined
      let seatsRemaining: number | undefined
      let memberCountExcludingOwner: number | undefined

      if (loggedIn) {
        const navigated = await client.navigateToChatGPTMembers('members')
        if (navigated) {
          const hint = await client.getChatGPTMemberCountHint()
          if (typeof hint === 'number' && Number.isFinite(hint)) {
            memberCount = hint
            memberCountExcludingOwner = Math.max(0, hint - 1)
            seatsRemaining = Math.max(0, memberLimit - hint)
          }
        }
      }

      await prisma.team.update({
        where: { id },
        data: {
          status: loggedIn ? 'active' : 'error',
          lastLoginCheckAt: now,
          loginError: loggedIn ? null : 'Not logged in',
          ...(typeof memberCount === 'number' ? { memberCount } : {}),
        },
      })

      return {
        success: true,
        initialized: true,
        loggedIn,
        memberCount,
        memberLimit,
        seatsRemaining,
        memberCountExcludingOwner,
        message: loggedIn ? '登录状态正常' : '登录已失效，需要重新初始化登录',
        checkedAt: now.toISOString(),
      }
    } catch (error) {
      const now = new Date()
      await prisma.team.update({
        where: { id },
        data: {
          status: 'error',
          lastLoginCheckAt: now,
          loginError: error instanceof Error ? error.message : 'Unknown error',
        },
      })

      return {
        success: false,
        initialized: true,
        loggedIn: false,
        message: `检测失败: ${error instanceof Error ? error.message : '未知错误'}`,
        checkedAt: now.toISOString(),
      }
    } finally {
      await client.close()
    }
  }

  async getAllTeams(): Promise<Team[]> {
    return await prisma.team.findMany({
      orderBy: { createdAt: 'desc' },
    })
  }

  async getTeamById(id: string): Promise<Team | null> {
    return await prisma.team.findUnique({
      where: { id },
      include: {
        members: true,
        inviteJobs: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    })
  }

  async createTeam(input: CreateTeamInput): Promise<Team> {
    // Encrypt the password
    const encryptedPassword = encrypt(input.password)

    // Prepare tags
    const tags = input.tags ? JSON.stringify(input.tags) : null

    // Prepare cookies (if provided from assisted login)
    const cookies = input.cookies ? JSON.stringify(input.cookies) : null

    return await prisma.team.create({
      data: {
        name: input.name,
        email: input.email,
        password: encryptedPassword,
        cookies,
        description: input.description,
        teamUrl: input.teamUrl,
        tags,
        autoInvite: input.autoInvite ?? false,
        inviteIntervalMs: input.inviteIntervalMs ?? 3000,
      },
    })
  }

  async updateTeam(input: UpdateTeamInput): Promise<Team> {
    const { id, password, tags, cookies, ...rest } = input

    const data: any = { ...rest }

    // Encrypt password if provided
    if (password) {
      data.password = encrypt(password)
    }

    // Update tags if provided
    if (tags) {
      data.tags = JSON.stringify(tags)
    }

    // Update cookies if provided
    if (cookies) {
      data.cookies = JSON.stringify(cookies)
    }

    return await prisma.team.update({
      where: { id },
      data,
    })
  }

  async deleteTeam(id: string): Promise<void> {
    await prisma.team.delete({
      where: { id },
    })
  }

  async verifyTeamCredentials(id: string): Promise<{
    success: boolean
    message: string
  }> {
    const team = await prisma.team.findUnique({ where: { id } })
    if (!team) {
      return { success: false, message: 'Team not found' }
    }

    try {
      // Decrypt password
      const password = decrypt(team.password)

      // Try to login using automation client
      const client = new OpenAIAutomationClient()
      await client.initialize()

      console.log('验证凭据 - 步骤1: 登录...')
      const loginSuccess = await client.login(team.email, password)

      if (!loginSuccess) {
        await client.close()

        // Update team status to error
        await prisma.team.update({
          where: { id },
          data: { status: 'error' },
        })

        return { success: false, message: '登录失败 - 凭据无效' }
      }

      console.log('验证凭据 - 步骤2: 选择工作空间...')
      const workspaceSelected = await client.selectWorkspace()

      await client.close()

      if (loginSuccess && workspaceSelected) {
        // Update team status
        await prisma.team.update({
          where: { id },
          data: {
            status: 'active',
            lastSyncAt: new Date(),
          },
        })

        return { success: true, message: '凭据验证成功，工作空间已选择' }
      } else if (loginSuccess) {
        // 登录成功但选择工作空间失败
        await prisma.team.update({
          where: { id },
          data: {
            status: 'active',
            lastSyncAt: new Date(),
          },
        })

        return { success: true, message: '凭据验证成功（未找到工作空间选择器，可能已在正确空间中）' }
      } else {
        // Update team status to error
        await prisma.team.update({
          where: { id },
          data: { status: 'error' },
        })

        return { success: false, message: '登录失败 - 凭据无效' }
      }
    } catch (error) {
      console.error('Error verifying credentials:', error)

      await prisma.team.update({
        where: { id },
        data: { status: 'error' },
      })

      return {
        success: false,
        message: `验证失败: ${error instanceof Error ? error.message : '未知错误'}`,
      }
    }
  }

  async syncTeamMembers(id: string): Promise<{
    success: boolean
    count: number
    message: string
  }> {
    const team = await prisma.team.findUnique({ where: { id } })
    if (!team) {
      return { success: false, count: 0, message: 'Team not found' }
    }

    try {
      const password = decrypt(team.password)

      const client = new OpenAIAutomationClient()
      const profileRoot = path.join(process.cwd(), '.automation-profiles')
      const profileDir = path.join(profileRoot, id)
      await fs.mkdir(profileDir, { recursive: true })
      await client.initialize({ userDataDir: profileDir })

      console.log('步骤1: 检查登录状态...')
      const interactive = process.env.OPENAI_AUTOMATION_INTERACTIVE === 'true'
      let loggedIn = await client.isChatGPTLoggedIn()

      if (!loggedIn) {
        console.log('未检测到登录状态，开始登录 ChatGPT...')
        loggedIn = await client.loginChatGPT(team.email, password, {
          allowManual: interactive,
        })
      }

      if (!loggedIn) {
        await client.close()
        return { success: false, count: 0, message: '登录失败或需要验证码/2FA' }
      }

      console.log('步骤2: 导航到成员管理页面...')
      const navigated = await client.navigateToChatGPTMembers('members')
      if (!navigated) {
        const screenshotPath = client.getLastDebugScreenshotPath()
        await client.close()
        return {
          success: false,
          count: 0,
          message: `无法打开成员管理页面${screenshotPath ? `，截图: ${screenshotPath}` : ''}`,
        }
      }

      console.log('步骤3: 提取成员信息...')
      const hint = await client.getChatGPTMemberCountHint()
      if (hint === null) {
        const screenshotPath =
          (await client.captureDebugScreenshot('sync-members-no-count')) ||
          client.getLastDebugScreenshotPath()
        await client.close()
        return {
          success: false,
          count: 0,
          message: `无法读取成员数（可能未选择正确工作空间/权限不足/页面结构变化）${screenshotPath ? `，截图: ${screenshotPath}` : ''}`,
        }
      }
      const memberEmails = await client.getChatGPTMemberEmails({
        excludeEmail: team.email,
      })

      // Prefer the UI hint on the Members page as the source of truth, because
      // emails are not always visible on the Members tab (can cause false matches).
      let memberCount =
        typeof hint === 'number' && Number.isFinite(hint) ? hint : memberEmails.length

      await client.close()

      await prisma.team.update({
        where: { id },
        data: {
          memberCount: memberCount,
          lastSyncAt: new Date(),
        },
      })

      return {
        success: true,
        count: memberCount,
        message:
          typeof hint === 'number'
            ? `同步成功！成员数（含账号）：${memberCount}`
            : `同步成功！成员数（含账号）：${memberCount}（未读取到页面成员数提示）`,
      }
    } catch (error) {
      console.error('Error syncing members:', error)
      return {
        success: false,
        count: 0,
        message: `同步失败: ${error instanceof Error ? error.message : '未知错误'}`,
      }
    }
  }

  async getTeamStats(id: string) {
    const team = await prisma.team.findUnique({
      where: { id },
      include: {
        members: true,
        inviteJobs: true,
      },
    })

    if (!team) return null

    const totalMembers = team.members.length
    const pendingMembers = team.members.filter((m) => m.status === 'pending').length
    const invitedMembers = team.members.filter((m) => m.status === 'invited').length
    const joinedMembers = team.members.filter((m) => m.status === 'joined').length
    const failedMembers = team.members.filter((m) => m.status === 'failed').length

    const totalJobs = team.inviteJobs.length
    const completedJobs = team.inviteJobs.filter((j) => j.status === 'completed').length
    const totalInvites = team.inviteJobs.reduce((sum, j) => sum + j.totalCount, 0)
    const successfulInvites = team.inviteJobs.reduce((sum, j) => sum + j.successCount, 0)

    return {
      totalMembers,
      pendingMembers,
      invitedMembers,
      joinedMembers,
      failedMembers,
      totalJobs,
      completedJobs,
      totalInvites,
      successfulInvites,
      successRate:
        totalInvites > 0 ? ((successfulInvites / totalInvites) * 100).toFixed(2) : '0',
    }
  }
}

export const teamService = new TeamService()
