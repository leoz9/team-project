'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Plus, Trash2, Edit, CheckCircle, XCircle, Users as UsersIcon, UserPlus, Loader2 } from 'lucide-react'

interface Team {
  id: string
  name: string
  email: string
  status: string
  loginInitialized: boolean
  lastLoginCheckAt?: string
  loginError?: string | null
  memberCount: number
  createdAt: string
}

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [autoInviteOpen, setAutoInviteOpen] = useState(false)
  const [autoEmailsText, setAutoEmailsText] = useState('')
  const [autoInviting, setAutoInviting] = useState(false)

  useEffect(() => {
    fetchTeams()
  }, [])

  const fetchTeams = async () => {
    try {
      const response = await fetch('/api/teams')
      const data = await response.json()
      setTeams(data)
    } catch (error) {
      console.error('获取团队列表失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const deleteTeam = async (id: string, name: string) => {
    if (!confirm(`确定要删除团队"${name}"吗？此操作不可恢复。`)) return

    try {
      await fetch(`/api/teams/${id}`, { method: 'DELETE' })
      fetchTeams()
    } catch (error) {
      console.error('删除团队失败:', error)
      alert('删除团队失败，请重试')
    }
  }

  const autoInvite = async () => {
    if (!autoEmailsText.trim()) {
      alert('请输入至少一个邮箱地址')
      return
    }

    const emails = autoEmailsText
      .split(/[,;\n]/)
      .map((email) => email.trim())
      .filter((email) => email.length > 0)

    if (emails.length === 0) {
      alert('请输入有效的邮箱地址')
      return
    }

    setAutoInviting(true)
    try {
      const response = await fetch('/api/invites/auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails }),
      })
      const result = await response.json()

      if (!response.ok) {
        alert(result.error || '自动邀请失败')
        return
      }

      alert(`已创建邀请任务，使用账号：${result.team?.name || result.team?.id}`)
      setAutoInviteOpen(false)
      setAutoEmailsText('')
      fetchTeams()
    } catch (error) {
      alert('自动邀请失败：' + (error instanceof Error ? error.message : '未知错误'))
    } finally {
      setAutoInviting(false)
    }
  }

  if (loading) {
    return (
      <div className="container flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4"></div>
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">团队管理</h1>
          <p className="text-muted-foreground">
            管理你的 GPT 团队账号
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={autoInviteOpen} onOpenChange={setAutoInviteOpen}>
            <DialogTrigger asChild>
              <Button
                size="lg"
                variant="outline"
                className="shadow-lg hover:shadow-xl transition-shadow"
              >
                <UserPlus className="mr-2 h-5 w-5" />
                自动邀请
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle>自动邀请</DialogTitle>
                <DialogDescription>
                  自动选择有空位且创建时间更早的账号执行邀请。
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-2">
                  <Label htmlFor="autoEmails">邀请邮箱</Label>
                  <Textarea
                    id="autoEmails"
                    placeholder="每行一个邮箱，或使用逗号/分号分隔"
                    value={autoEmailsText}
                    onChange={(e) => setAutoEmailsText(e.target.value)}
                    rows={6}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setAutoInviteOpen(false)}
                  disabled={autoInviting}
                >
                  取消
                </Button>
                <Button onClick={autoInvite} disabled={autoInviting}>
                  {autoInviting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      创建任务中...
                    </>
                  ) : (
                    <>
                      <UserPlus className="mr-2 h-4 w-4" />
                      开始自动邀请
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Link href="/teams/new">
            <Button size="lg" className="shadow-lg hover:shadow-xl transition-shadow">
              <Plus className="mr-2 h-5 w-5" />
              添加团队
            </Button>
          </Link>
        </div>
      </div>

      {teams.length === 0 ? (
        <Card className="border-2">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-muted">
              <UsersIcon className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">还没有团队</h3>
            <p className="mb-6 text-center text-muted-foreground max-w-sm">
              开始添加你的第一个 GPT 团队账号，开启高效的团队管理之旅
            </p>
            <Link href="/teams/new">
              <Button size="lg">
                <Plus className="mr-2 h-5 w-5" />
                创建第一个团队
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-2">
          <CardHeader>
            <CardTitle>所有团队 ({teams.length})</CardTitle>
            <CardDescription>
              查看和管理所有团队账号
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">团队名称</TableHead>
                    <TableHead className="font-semibold">邮箱</TableHead>
                    <TableHead className="font-semibold">状态</TableHead>
                    <TableHead className="font-semibold">登录</TableHead>
                    <TableHead className="font-semibold">成员数</TableHead>
                    <TableHead className="font-semibold">创建时间</TableHead>
                    <TableHead className="text-right font-semibold">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teams.map((team) => (
                    <TableRow key={team.id} className="hover:bg-muted/30">
                      <TableCell className="font-medium">
                        <Link
                          href={`/teams/${team.id}`}
                          className="hover:text-primary hover:underline inline-flex items-center"
                        >
                          <UsersIcon className="mr-2 h-4 w-4" />
                          {team.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{team.email}</TableCell>
                      <TableCell>
                        <div className="flex items-center">
                          {team.status === 'active' ? (
                            <span className="inline-flex items-center rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-600">
                              <CheckCircle className="mr-1 h-3 w-3" />
                              活跃
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-600">
                              <XCircle className="mr-1 h-3 w-3" />
                              {team.status === 'error' ? '错误' : '未激活'}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {team.loginInitialized ? (
                          <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                            已初始化
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                            未初始化
                          </span>
                        )}
                        {team.status === 'error' && team.loginError ? (
                          <div className="text-xs text-red-600 mt-1 line-clamp-1">
                            {team.loginError}
                          </div>
                        ) : null}
                        {team.lastLoginCheckAt ? (
                          <div className="text-xs text-muted-foreground mt-1">
                            {new Date(team.lastLoginCheckAt).toLocaleString('zh-CN')}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            team.memberCount >= 5
                              ? 'bg-red-500/10 text-red-600'
                              : team.memberCount >= 4
                              ? 'bg-amber-500/10 text-amber-700'
                              : 'bg-blue-500/10 text-blue-600'
                          }`}
                          title="成员数（含账号）/5"
                        >
                          {team.memberCount}/5
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(team.createdAt).toLocaleDateString('zh-CN', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Link href={`/teams/${team.id}/edit`}>
                            <Button variant="ghost" size="sm" className="hover:bg-primary/10">
                              <Edit className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="hover:bg-red-500/10 hover:text-red-600"
                            onClick={() => deleteTeam(team.id, team.name)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
