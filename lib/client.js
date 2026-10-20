window.__ModuleLoader__.load({
  id: "dsh-persona-card",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");

    const inject = ["slots"];

    const API = "/api/persona";

    function cs(...parts) {
      return parts.filter(Boolean).join(" ");
    }

    function PersonaView() {
      const s1 = React.useState(null); const data = s1[0]; const setData = s1[1];
      const s2 = React.useState(null); const selected = s2[0]; const setSelected = s2[1];
      const s3 = React.useState(""); const name = s3[0]; const setName = s3[1];
      const s4 = React.useState(""); const prompt = s4[0]; const setPrompt = s4[1];
      const s5 = React.useState("loading"); const status = s5[0]; const setStatus = s5[1];
      const s6 = React.useState(null); const err = s6[0]; const setErr = s6[1];
      const s7 = React.useState(false); const dirty = s7[0]; const setDirty = s7[1];

      const refresh = React.useCallback(function (keepSelection) {
        setStatus("loading");
        fetch(API)
          .then(function (r) { return r.json() })
          .then(function (d) {
            if (d.error) { setStatus("error"); setErr(d.error); return }
            setData(d);
            setErr(null);
            setStatus("ready");
            const target = keepSelection && d.cards.some(function (c) { return c.id === keepSelection })
              ? keepSelection
              : (d.activeId || (d.cards[0] && d.cards[0].id) || null);
            setSelected(target);
            const card = d.cards.find(function (c) { return c.id === target });
            setName(card ? card.name : "");
            setPrompt(card ? card.prompt : "");
            setDirty(false);
          })
          .catch(function (e) { setStatus("error"); setErr(String(e)) });
      }, []);

      React.useEffect(function () { refresh(null) }, [refresh]);

      function pick(card) {
        if (dirty && !window.confirm("当前编辑未保存,切换会丢弃改动。继续?")) return;
        setSelected(card.id);
        setName(card.name);
        setPrompt(card.prompt || "");
        setDirty(false);
        setErr(null);
      }

      function activate(id) {
        setStatus("saving");
        fetch(API, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "active", id: id })
        })
          .then(function (r) { return r.json() })
          .then(function (d) {
            if (d.ok) { refresh(id); setStatus("saved"); }
            else { setStatus("error"); setErr(d.error || "切换失败") }
          })
          .catch(function (e) { setStatus("error"); setErr(String(e)) });
      }

      function save() {
        setStatus("saving");
        fetch(API, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "save", id: selected || "", name: name, prompt: prompt })
        })
          .then(function (r) { return r.json() })
          .then(function (d) {
            if (d.ok) { setDirty(false); refresh(d.card && d.card.id ? d.card.id : selected); setStatus("saved"); }
            else { setStatus("error"); setErr(d.error || "保存失败") }
          })
          .catch(function (e) { setStatus("error"); setErr(String(e)) });
      }

      function createNew() {
        if (dirty && !window.confirm("当前编辑未保存,新建会丢弃改动。继续?")) return;
        setSelected("");
        setName("新人格");
        setPrompt("");
        setDirty(true);
        setErr(null);
        setStatus("ready");
      }

      function remove(id) {
        const card = data && data.cards.find(function (c) { return c.id === id });
        if (!window.confirm("删除人格卡「" + (card ? card.name : id) + "」?")) return;
        setStatus("saving");
        fetch(API, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "delete", id: id })
        })
          .then(function (r) { return r.json() })
          .then(function (d) {
            if (d.ok) { refresh(null); setStatus("saved"); }
            else { setStatus("error"); setErr(d.error || "删除失败") }
          })
          .catch(function (e) { setStatus("error"); setErr(String(e)) });
      }

      if (data === null) {
        return React.createElement("div", { className: "pcard" },
          React.createElement("div", { className: "pcard__hint" }, status === "error" ? (err || "加载失败") : "正在读取人格卡…"));
      }

      const activeId = data.activeId || "";
      const activeCard = data.cards.find(function (c) { return c.id === activeId });

      const statusText = status === "loading" ? "读取中…"
        : status === "saving" ? "提交中…"
        : status === "saved" ? "已生效"
        : status === "error" ? (err || "出错")
        : (dirty ? "未保存" : "就绪");

      const list = data.cards.map(function (card) {
        const isActive = card.id === activeId;
        const isSelected = card.id === selected;
        return React.createElement("div", {
          key: card.id,
          className: cs("pcard__item", isSelected && "pcard__item--sel", isActive && "pcard__item--on"),
          onClick: function () { pick(card) }
        },
          React.createElement("div", { className: "pcard__itemMain" },
            React.createElement("span", { className: "pcard__itemName" }, card.name),
            isActive ? React.createElement("span", { className: "pcard__badge" }, "生效中") : null),
          React.createElement("div", { className: "pcard__itemActs" },
            React.createElement("button", {
              className: "pcard__mini",
              title: isActive ? "关闭这个人格" : "让这个人格生效",
              onClick: function (e) { e.stopPropagation(); activate(isActive ? "" : card.id) }
            }, isActive ? "停用" : "启用"),
            React.createElement("button", {
              className: "pcard__mini pcard__mini--danger",
              title: "删除",
              onClick: function (e) { e.stopPropagation(); remove(card.id) }
            }, "删")
          )
        );
      });

      return React.createElement("div", { className: "pcard" },
        React.createElement("div", { className: "pcard__head" },
          React.createElement("span", { className: "pcard__title" }, "人格卡"),
          React.createElement("span", {
            className: cs("pcard__status", status === "error" && "pcard__status--err")
          }, statusText),
          React.createElement("span", { className: "pcard__active" },
            activeCard ? "当前：" + activeCard.name : "当前：无(出厂人格)")),
        React.createElement("div", { className: "pcard__body" },
          React.createElement("div", { className: "pcard__side" },
            React.createElement("div", { className: "pcard__list" }, list),
            React.createElement("button", { className: "pcard__new", onClick: createNew }, "+ 新建人格")),
          React.createElement("div", { className: "pcard__main" },
            React.createElement("div", { className: "pcard__row" },
              React.createElement("input", {
                className: "pcard__name",
                value: name,
                placeholder: "人格名称",
                onChange: function (e) { setName(e.target.value); setDirty(true) }
              }),
              React.createElement("button", {
                className: "pcard__save",
                onClick: save,
                disabled: status === "saving" || status === "loading" || !dirty
              }, selected ? "保存修改" : "创建并保存")),
            React.createElement("textarea", {
              className: "pcard__edit",
              value: prompt,
              spellCheck: false,
              placeholder: "在这里写这个人格怎么说话、怎么想、叫什么。\n\n留空 = 关闭人格(回到出厂设定)。",
              onChange: function (e) { setPrompt(e.target.value); setDirty(true) }
            }),
            React.createElement("div", { className: "pcard__foot" },
              React.createElement("span", { className: "pcard__hint" },
                selected ? "改完点保存,下一条消息即生效" : "新人格:填好名称和内容后点「创建并保存」"),
              prompt.length > 0
                ? React.createElement("span", { className: "pcard__count" }, prompt.length + " 字")
                : null)))
      );
    }

    function apply(ctx) {
      const css = [
        ".pcard{display:flex;flex-direction:column;height:100%;min-height:0;padding:4px 2px;gap:10px;box-sizing:border-box;font-size:13px;max-width:960px;}",
        ".pcard__head{display:flex;align-items:center;gap:10px;flex:none;}",
        ".pcard__title{font-weight:600;font-size:13px;}",
        ".pcard__status{font-size:11px;color:var(--dsw-alias-label-secondary);}",
        ".pcard__status--err{color:var(--dsw-alias-state-error-primary);}",
        ".pcard__active{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:50%;}",
        ".pcard__body{display:flex;gap:12px;flex:1;min-height:0;}",
        ".pcard__side{display:flex;flex-direction:column;gap:6px;width:200px;flex:none;min-height:0;}",
        ".pcard__list{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:4px;padding-right:2px;}",
        ".pcard__item{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:7px;cursor:pointer;border:1px solid transparent;background:var(--dsw-alias-bg-layer-1);}",
        ".pcard__item:hover{border-color:var(--dsw-alias-border-l1);}",
        ".pcard__item--sel{border-color:var(--dsw-alias-border-l2);}",
        ".pcard__item--on{background:var(--dsw-alias-bg-layer-2);}",
        ".pcard__itemMain{display:flex;align-items:center;gap:6px;flex:1;min-width:0;}",
        ".pcard__itemName{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
        ".pcard__badge{font-size:10px;padding:1px 5px;border-radius:99px;background:var(--dsw-alias-brand-primary);color:#fff;flex:none;}",
        ".pcard__itemActs{display:flex;gap:3px;flex:none;opacity:0;transition:opacity .12s;}",
        ".pcard__item:hover .pcard__itemActs{opacity:1;}",
        ".pcard__mini{font-size:10px;padding:2px 6px;border-radius:5px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;}",
        ".pcard__mini:hover{color:var(--dsw-alias-label-primary);}",
        ".pcard__mini--danger:hover{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);}",
        ".pcard__new{flex:none;padding:6px 8px;font-size:12px;border-radius:7px;border:1px dashed var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;}",
        ".pcard__new:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);}",
        ".pcard__main{display:flex;flex-direction:column;gap:8px;flex:1;min-width:0;min-height:0;}",
        ".pcard__row{display:flex;gap:8px;flex:none;}",
        ".pcard__name{flex:1;min-width:0;padding:7px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;box-sizing:border-box;}",
        ".pcard__save{flex:none;padding:7px 14px;border-radius:7px;border:none;background:var(--dsw-alias-brand-primary);color:#fff;font-size:12px;cursor:pointer;}",
        ".pcard__save:disabled{opacity:.5;cursor:default;}",
        ".pcard__edit{flex:1;min-height:0;width:100%;resize:none;padding:10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.7;box-sizing:border-box;}",
        ".pcard__foot{display:flex;align-items:center;gap:10px;flex:none;}",
        ".pcard__hint{font-size:11px;color:var(--dsw-alias-label-secondary);}",
        ".pcard__count{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);}"
      ].join("");

      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
      ctx.effect(function () { return function () { style.remove() } }, "dsh-persona-card: css");

      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: "persona-card",
          order: 45,
          label: "人格卡"
        }, function () {
          return React.createElement(PersonaView, null)
        })
      })
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
