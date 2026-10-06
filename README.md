# Waygate

**Operate your desktop AI apps from anywhere — your chat becomes the client.**

Waygate is a remote-access platform for desktop AI applications. It lets you reach the AI
running on your own machine — watch progress, send messages, interrupt a run, answer
approvals and questions, and let the agent work on that machine's files — from whatever
client channel you already have open.

A web browser first. DingTalk, Feishu and WeCom next. The WeChat Mini Program after that.

> **Status: design stage.** There is no implementation yet. The design is complete enough
> to review and to argue with; the risks that must be validated before any code is written
> are listed below.

---

## Why another one of these

The "control your local agent from your phone" space is already crowded, and most of it
looks nothing like this. Four differences are deliberate:

| | Most existing projects | Waygate |
|---|---|---|
| **Target** | Local **CLI coding agents** (Claude Code, Codex, Cursor) | **Desktop AI applications** — GUI apps with their own session models |
| **Client** | Their own app to install (Android / web / terminal) | **Channels you already have open** — nothing new to install |
| **Integration** | Adapt to one agent, one at a time | An **integration contract** with capability negotiation — any desktop app joins, and the platform does not change for it |
| **Identity** | Platform owns accounts and users | **Identity stays with the integrator.** The platform never holds your users |

The integration contract is the actual product. Everything else is replaceable plumbing.

## The three parts

```
client channels          platform                    integrator (your machine)
┌──────────────┐        ┌───────────────────────┐        ┌────────────────────────┐
│ web          │        │  channel layer   relay │        │  resident agent host   │
│ DingTalk     │─wss──▶ │        │           ▲   │ ◀─wss──│  (your desktop app)    │──▶ your backend
│ Feishu/WeCom │        │        └───────────┘   │        │                        │
│ WeChat MP    │        └───────────────────────┘        └────────────────────────┘
└──────────────┘
```

| Part | Responsibility | Explicitly not responsible for |
|---|---|---|
| **Relay** | Being a dumb pipe. Gives two endpoints behind different NATs a rendezvous point; pairs them and forwards frames. | Parsing business payloads, holding tokens, storing business data |
| **Client channel layer** | Plug-in clients. Owns transport, how identity assertions are obtained, the rendering surface, and push notifications. Channel-specific quirks stop here. | Understanding business semantics, deciding identity |
| **Integration contract** | A stable interface a desktop app implements. Fixed core model plus capability flags. | Defining your UI — clients have their own fixed UI |

## Design

- [Remote access platform design](docs/2026-10-06-remote-access-platform-design.md) — Chinese; the full design, including the alternatives that were rejected and why.

## Risks to validate before implementation

| # | Risk | Why it matters |
|---|---|---|
| 1 | **No WebCrypto in the WeChat Mini Program runtime** — ECDH/AEAD must come from a pure-JS library or `WXWebAssembly` | Decides whether end-to-end encryption is possible on that channel, or whether it degrades to TLS-only |
| 2 | Long-connection stability across background/foreground on each channel | Decides how strong reconnection and resync have to be |
| 3 | Bandwidth cost of proxying images and artifacts through the relay | Decides whether v1 ships thumbnails or no preview at all |
| 4 | How the identity-assertion page is hosted for `assertion` mode | An administrative prerequisite (business domain, non-personal entity) |

Selecting a browser-based channel first is not an accident: browsers have standard
`WebSocket` **and** WebCrypto, which defers risks 1 and 2 instead of betting on them.

## Honest limits

Three things this platform **cannot** do. They are stated plainly in the design because
people otherwise assume the opposite:

- **It cannot force high-risk confirmation.** The integrator is an independently controlled
  process; the platform can only witness and audit. The obligation is contractual, not enforced.
- **It cannot revoke an already-issued session key.** Keys live at both endpoints. The only
  real revocation point is the integrator refusing the handshake.
- **It does not do concurrency control.** Serializing write commands is the integrator's job;
  the platform only forwards in arrival order.

## Related work

Adjacent projects worth knowing about, especially if you are here for CLI coding agents:

- [liguobao/ds-harness-remote](https://github.com/liguobao/ds-harness-remote) — multi-device, E2E, P2P-first
- [714307168/AgentFlow](https://github.com/714307168/AgentFlow) — Android app plus a minimal public relay
- [anywhere-labs/Agents-Anywhere](https://github.com/anywhere-labs/Agents-Anywhere) — cross-device agent workbench
- [Riccardo8888/agent-link](https://github.com/Riccardo8888/agent-link) — E2E channel between coding agents
- [iYassr/shahi](https://github.com/iYassr/shahi) — plugin, QR pairing, phone as the chat surface
- [turnwire/turnwire](https://github.com/turnwire/turnwire) — self-hosted sessions with your own encrypted relay

Where they lead, Waygate borrows freely: **LAN/P2P first with relay fallback** is strictly
better than relay-only, and belongs in this design.

## 中文简介

Waygate 是**桌面 AI 应用的远程接入平台**。你不在电脑前时，可以从已经在用的聊天入口
（先浏览器，再钉钉/飞书/企业微信，最后微信小程序）继续使用那台电脑上的 AI：看进度、
发消息、中断执行、审批与提问、让 Agent 操作本机工作区。

三句话概括边界：**中转只是哑管道**，不解析业务、不持 token；**客户端渠道可插拔**，
渠道自己的限制留在渠道层；**身份归接入方**，平台不持有你的用户。

与本仓库相关的一条设计取舍：LAN/P2P 优先、失败回退中继，严格优于纯中继，会补进设计。

## License

Apache-2.0
