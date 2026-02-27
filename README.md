# GPT 团队管理器（ChatGPT Workspace）

一个用于统一管理多个 ChatGPT 工作空间账号的 Web 应用，支持账号池管理、登录状态持久化、成员/席位同步，以及浏览器自动化邀请成员。

## 功能特性

- **账号池管理**：集中管理多个工作空间账号（状态、成员数、邀请任务）
- **初始化登录（持久化会话）**：首次手动登录一次后保存会话（复用 `.automation-profiles/<teamId>`），后续自动化无需重复登录
- **登录检测与提醒**：支持手动检测 + 页面内定时检测（登录失效/满员会提示）
- **成员/席位同步**：从 `https://chatgpt.com/admin/members` 读取成员数（含账号）并计算剩余席位（默认上限 5）
- **自动化邀请**：浏览器自动化邀请成员，支持工作空间选择弹窗（自动选择非 Personal account）
- **号池自动邀请**：控制台“一键自动邀请”，自动选择「有空位 + 创建时间更早」的账号执行邀请
- **安全凭据存储**：使用 AES-256-GCM 加密存储密码
- **进度追踪**：实时监控邀请任务状态
- **成员管理**：追踪邀请状态和成员列表
- **统计视图**：概览成员数、邀请任务与结果

## 技术栈

- **框架**：Next.js 14+ (App Router) + TypeScript
- **数据库**：SQLite (开发环境) / PostgreSQL (生产环境) + Prisma ORM
- **自动化**：Puppeteer + stealth 插件
- **UI**：Tailwind CSS + shadcn/ui
- **验证**：Zod

## 项目结构

```
team-project/
├── .github/workflows/         # GitHub Actions CI/CD
│   └── docker-build.yml       # 自动构建多架构 Docker 镜像
├── prisma/
│   ├── schema.prisma          # 数据库模型
│   └── migrations/            # 数据库迁移文件
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── api/              # API 路由
│   │   ├── dashboard/        # 仪表板页面
│   │   ├── teams/            # 团队管理页面
│   │   └── page.tsx          # 首页
│   ├── components/           # React 组件
│   │   └── ui/              # shadcn/ui 基础组件
│   └── lib/                 # 核心业务逻辑
│       ├── automation/      # 浏览器自动化
│       ├── services/        # 业务服务层
│       └── utils/           # 工具函数（加密、验证）
├── Dockerfile                 # 多阶段构建（内置 Chromium）
├── docker-compose.yml         # 一键部署配置
└── .env                       # 环境变量文件
```

## 快速开始

### 前置条件

- Node.js 18+
- npm 或 yarn

### 安装步骤

1. 克隆仓库：
```bash
git clone <你的仓库地址>
cd team-project
```

2. 安装依赖：
```bash
npm install
```

3. 配置环境变量：

项目已创建 `.env` 文件并设置了默认值，根据需要更新：

```env
DATABASE_URL="file:./dev.db"
ENCRYPTION_KEY="<你的32字节十六进制密钥>"
NEXTAUTH_SECRET="<你的密钥>"
NEXTAUTH_URL="http://localhost:3000"
OPENAI_AUTOMATION_HEADLESS=true
OPENAI_AUTOMATION_INTERACTIVE=false
CHATGPT_MEMBER_LIMIT=5
```

4. 初始化数据库：
```bash
npx prisma generate
npx prisma migrate dev
```

5. 启动开发服务器：
```bash
npm run dev
```

6. 在浏览器中打开 [http://localhost:3000](http://localhost:3000)

## 使用指南

### 1）添加账号（团队）

1. 导航到团队页面
2. 点击「添加团队」
3. 输入团队信息：
   - 团队名称
   - 邮箱（账号邮箱）
   - 密码（将被加密存储）
   - 可选：团队 URL、描述、标签
4. 点击「创建团队」

建议：创建后点击「初始化登录」，在弹出的浏览器窗口内完成一次登录（可能包含验证码/2FA）。成功后会保存会话，后续自动化无需重复登录。

### 2）初始化登录（保存会话）

- 团队详情页点击「初始化登录」，完成后会把会话保存到 `.automation-profiles/<teamId>`，并同步 cookies 到数据库。
- 若你需要手动处理验证码/2FA，可临时设置：
  - `OPENAI_AUTOMATION_INTERACTIVE=true`
  - `OPENAI_AUTOMATION_HEADLESS=false`

### 3）检测登录状态

- 团队详情页点击「检测登录」，会检查登录是否有效，并顺便读取成员数（含账号）与剩余席位。
- 详情页打开后会每 15 分钟自动检测：登录从正常变为失效、或席位从未满变为满员（5/5）会提示。

### 4）同步成员数（席位）

- 点击「自动同步」会读取 `admin/members` 页面显示的 `X members`（含账号）并更新到 `Team.memberCount`。
- 成员卡会显示：
  - 成员数（含账号）：`memberCount/5`
  - 其他成员（不含账号）：`memberCount - 1`
  - 剩余席位：`5 - memberCount`

### 5）邀请成员（单账号）

1. 进入团队详情页面
2. 点击「邀请成员」
3. 输入邮箱地址（每行一个或用逗号分隔）
4. 点击「开始邀请」
5. 实时监控邀请进度

### 6）自动邀请（号池）

在 `/teams` 页面点击「自动邀请」，输入邮箱列表后提交：
- 系统自动选择「有空位 + 创建更早」的账号执行邀请
- 如果没有可用账号（未初始化登录/满员/状态异常），会返回错误提示

### 查看状态与统计

- 团队列表显示登录初始化状态与最近检测时间
- 团队详情页面提供邀请历史记录

## API 接口

### 团队管理

- `GET /api/teams` - 获取所有团队
- `POST /api/teams` - 创建团队
- `GET /api/teams/:id` - 获取团队详情
- `PUT /api/teams/:id` - 更新团队信息
- `DELETE /api/teams/:id` - 删除团队
- `POST /api/teams/:id/verify` - 验证账号凭据
- `POST /api/teams/:id/sync` - 同步成员列表
- `POST /api/teams/:id/init-login` - 初始化登录（可视浏览器，保存会话）
- `POST /api/teams/:id/check-login` - 检测登录状态（并读取成员数/席位）

### 成员管理

- `GET /api/members?teamId=xxx` - 获取团队成员列表
- `POST /api/members` - 添加成员
- `DELETE /api/members/:id` - 删除成员

### 邀请管理

- `GET /api/invites?teamId=xxx` - 获取邀请任务列表
- `POST /api/invites` - 创建邀请任务
- `POST /api/invites/auto` - 号池自动邀请（自动选账号）

## 安全注意事项

1. **密码加密**：所有团队密码在存储前使用 AES-256-GCM 加密
2. **环境变量**：敏感数据存储在 `.env` 文件中（不提交到 Git）
3. **浏览器自动化**：使用 stealth 插件避免被检测
4. **会话与 profile**：`.automation-profiles/` 保存浏览器会话（已加入 `.gitignore`），请妥善保护服务器权限/备份策略
5. **请求限流**：可配置邀请间隔，避免触发限制

## 重要说明

### ChatGPT 界面更新

浏览器自动化依赖 ChatGPT 当前的界面结构。如果页面更新导致选择器变化：

1. `src/lib/automation/openai-client.ts` 中的选择器可能需要更新
2. 在生产环境使用前进行充分测试
3. 考虑实现备用策略

### 合规性

- 确保遵守相关服务条款与当地法律法规
- 负责任地使用自动化功能
- 本工具仅用于合法的团队管理目的

### 性能

- 浏览器自动化消耗较多资源
- 浏览器池限制并发操作数量（默认：5）
- 使用无头模式减少资源占用
- 若需要并发 2+、更高稳定性，建议使用 2c/4g 以上服务器

## Docker 部署（推荐）

项目已配置 GitHub Actions 自动构建多架构 Docker 镜像（amd64 + arm64），镜像内置 Chromium，开箱即用。

### 使用预构建镜像

```bash
# 拉取并启动（Mac M 系列 / Intel / Linux 通用）
docker compose up -d

# 查看日志
docker compose logs -f
```

### 本地构建

```bash
docker compose up -d --build
```

### 环境变量

在 `docker-compose.yml` 中配置，或创建 `.env` 文件：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | SQLite 数据库路径 | `file:/app/data/dev.db` |
| `NEXTAUTH_URL` | 应用访问地址 | `http://localhost:3000` |
| `NEXTAUTH_SECRET` | NextAuth 密钥 | 需自行设置 |
| `ENCRYPTION_KEY` | AES 加密密钥 | 需自行设置 |

### 数据持久化

数据库文件挂载到 Docker Volume `app-data`，容器重建不会丢失数据。

### 镜像地址

- `ghcr.io/leoz9/team-project:latest` — 最新主分支
- `ghcr.io/leoz9/team-project:v*` — 版本标签

## 部署建议

- **不推荐 Serverless/边缘函数直接跑自动化**：Puppeteer/Chromium 与长任务不适合 Worker/Edge 平台。
- 推荐使用 Docker 部署，镜像已内置 Chromium 及所有依赖，无需额外安装。
- Mac（M1/M2/M3）和 Linux（x86）均可直接使用，无兼容性问题。
- 若需要并发 2+、更高稳定性，建议使用 2c/4g 以上服务器。

## 开发指南

### 运行测试
```bash
# 根据需要添加测试
npm test
```

### 构建生产版本
```bash
npm run build
npm start
```

### ESLint

首次执行 `npm run lint` 可能会进入 Next.js 的交互式 ESLint 初始化向导（按提示选择配置即可）。

### 数据库管理
```bash
# 在 Prisma Studio 中查看数据库
npx prisma studio

# 创建新的迁移
npx prisma migrate dev --name <迁移名称>

# 重置数据库
npx prisma migrate reset
```

## 故障排除

### 数据库问题
- 确保 DATABASE_URL 设置正确
- 架构变更后运行 `npx prisma generate`
- 检查 SQLite 数据库文件的权限

### 浏览器自动化问题
- 验证 Chromium 已安装（Puppeteer 应自动安装）
- 检查系统资源是否充足（浏览器启动失败时）
- 调试时启用 `OPENAI_AUTOMATION_INTERACTIVE=true` 与 `OPENAI_AUTOMATION_HEADLESS=false`
- 若出现工作空间选择弹窗卡住：确保账号有对应 workspace 权限，并完成一次「初始化登录」

### API 错误
- 查看浏览器控制台获取详细错误信息
- 验证 API 接口是否可访问
- 确保数据库已正确迁移

## 未来规划

- [ ] 卡密/免登录邀请入口（Worker/网关 + 后端执行机）
- [ ] 更完善的任务队列与并发控制
- [ ] 更强的防刷与审计（限流/验证码/日志）
- [ ] 高级统计和报告功能
- [ ] 导出功能
- [ ] 任务队列（BullMQ/Redis）
- [ ] 多语言支持
- [ ] 邮件通知
- [ ] Webhook 集成

## 许可证

MIT License

## 支持

如有问题和建议，请在 GitHub 上提交 Issue。
