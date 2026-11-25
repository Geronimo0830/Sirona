# 实现与边界

主进程负责文件、原生文件选择器、模型网络、系统密钥加密；隔离的 preload 只暴露具名方法。Renderer 无 Node 权限、不能读密钥或任意路径。资源由本地 novel://app 协议提供，CSP 禁止界面联网，AI 输出作为 React 文本呈现。

文稿状态集中在 DocumentBuffer：单个在途请求、最新缓冲合并、版本应答更新 hash。主进程每个 docId 单独排队；workspace 元数据与辅助状态分队列串行写入。正文保存核对作品、会话、revision、磁盘 hash；同目录临时文件先 flush，再 rename，失败不先删除目标。副本和历史失败不会继续覆盖原文。

AI 请求的原章、编辑会话、版本、hash、位置、参考内容与模型配置在发送时冻结。全应用一个 AbortController，停止等待最终聊天写入。默认 60 秒首响应和 10 分钟总时限；测试另注入短时限。正文采纳前后检查状态，写历史后再次核对，CodeMirror 独立事务支持一笔撤销。没有后台 Agent、定时模型调用或重试。

导入先扫描 hash，原始字节复制到新目录，再转换为自由文档，逐文件记录源路径/docId。转换失败可为 partial，但归档失败为 failed。目录联接与符号链接不遍历。备份锁定程序写入并校验源/目标，不覆盖已有目标。

首版文件按逻辑集中在 workspace/store.ts、migration/index.ts、ai/index.ts 与 renderer/App.tsx。IPC 定义目前在 main.ts，未为小规模逻辑再拆 ipc.ts；组件暂未按任务书示意目录逐个拆文件。此结构差异不改变协议与产品范围。

原插件只作为格式和行为参考，28 文件快照保存在 vendor，不进入发行包。未接入其运行代码或凭据。
