# dsh-swap-enter

把 DeepSeek Harness 聊天输入框里的 <kbd>Enter</kbd> 和 <kbd>Shift</kbd>+<kbd>Enter</kbd> 换过来。

- **<kbd>Enter</kbd>** → 插入换行
- **<kbd>Shift</kbd>+<kbd>Enter</kbd>** → 发送消息

飞书、Slack、Telegram 都是「裸键换行、加修饰键发送」，而 DSH 默认是反过来的。这个插件把它翻过来。

[English](README.md) | 中文

## 安装

从插件市场安装（dsh-market，或任何基于 `awesome-dsh-plugin` 索引的商店）：

```sh
dsh plugin --profile <profile> add github:64511982lin-hash/dsh-swap-enter
```

或者让 `plugin_manager` 指向本地目录：

```
plugin_manager install_bundle { target: "<本目录的绝对路径>" }
```

没有构建步骤，没有运行时依赖——整个包就是纯 ES 模块。宿主那一半是空实现，所有逻辑都发生在浏览器 bundle 里。

安装后刷新 Web UI 即可，没有任何需要配置的选项。

## 不会被动到的地方

互换两个键，不能把 <kbd>Enter</kbd> 原本干的别的事情搞坏：

| 场景 | 行为 |
|---|---|
| 补全菜单、斜杠命令菜单打开时 | 不干预——<kbd>Enter</kbd> 仍然选中高亮项 |
| 输入法正在组字（中/日/韩） | 不干预——组字中的按键根本到不了插件 |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>/<kbd>Alt</kbd> + <kbd>Enter</kbd> | 不干预——互补快捷键照旧 |
| 输入框只读时 | 不干预 |
| 焦点不在输入框内 | 不干预 |
| 插件被卸载（切 profile、HMR） | 不干预——恢复成官方原行为 |

长按 <kbd>Shift</kbd>+<kbd>Enter</kbd> 只会发一条，不是每个重复节拍发一条：自动重复的标记会一路透传给提交路径。

## 为什么这只能做成插件，而不是一个设置项

没有可以拨的键位开关。客户端 `ui-conversation` 插件的配置 schema 只有一个字段——`busyEnter`（`queue` 或 `steer`）——而键盘命令注册表里能看到的 `fixed.send` / `fixed.newline` 是**纯展示用的记录**：它们只是把绑定关系描述给设置界面看，并不负责把按键路由到对应功能。

真正的行为分散在官方输入框的**两条不同的代码路径**里：

1. **<kbd>Shift</kbd>+<kbd>Enter</kbd> 压根不在 JavaScript 里处理。** 输入框的 `KEY_ENTER` 命令对 shift+Enter 直接 `return false`，让**浏览器默认动作**去插入换行。
2. **裸 <kbd>Enter</kbd> 是在那个命令内部调用 `handlers.submit()`。**

所以互换必须把两条路径分别重新走一遍，而不是翻一个标志位，也不可能只靠一种机制同时搞定两者。

## 实现方式

`client.js` 在 `document` 上以**捕获阶段**挂一个 `keydown` 监听，它会早于 Lexical 挂在编辑器根元素上的监听执行。当来自 `[data-composer-input]` 内部的裸 <kbd>Enter</kbd> 到达时，先用 `preventDefault()` + `stopImmediatePropagation()` 取消原事件，再按相反方向重放：

- **<kbd>Shift</kbd>+<kbd>Enter</kbd>（发送）**——派发一个 `shiftKey: false` 的合成 `keydown`，重新走一遍官方自己的提交路径，包括它那套忙碌/插话（steer）规则。
- **<kbd>Enter</kbd>（换行）**——派发一个可取消的 `InputEvent('beforeinput', { inputType: 'insertLineBreak' })`。Lexical 的 beforeinput 处理器会插入换行并取消事件。这里**不能**用 `shiftKey: true` 的合成 keydown：非受信事件没有默认动作，换行永远不会被插入。

插件自己合成的按键会在一个 `WeakSet` 里打上标记，因此任何监听器实例——包括热重载产生的第二个——都不会二次拦截它们。

## 兼容性

- 声明支持 `dsh` `>=0.2.0-rc.1 <0.3.0-0`。
- 在 DSH `0.2.2-rc.1`（桌面版）上开发并验证。
- 仅限 Web UI（`dsh.client.platform: "web"`）。

这套机制依赖输入框是带 `data-composer-input` 属性的 Lexical 编辑器、并且存在 `beforeinput` 桥接——这两点在 0.2.x 系列都成立。将来若重写输入框，可能就不成立了。

## 测试

```sh
node test/swap-enter.test.cjs
```

八个用例跑的是**真实的** `client.js`，跑在一个复刻了两条提交/换行路径的桩 DOM 里：

```
PASS  Enter -> line break
PASS  Shift+Enter -> send
PASS  Ctrl+Enter untouched
PASS  menu open -> untouched
PASS  read-only -> untouched
PASS  IME composing -> untouched
PASS  outside composer -> untouched
PASS  after dispose -> shipped behavior
```

## 许可证

MIT
