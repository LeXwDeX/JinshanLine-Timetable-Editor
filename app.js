(() => {
  // ---------------------------
  // 基础状态与工具
  // ---------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const els = {
    tabs: $$(".tabs .tab"),
    metaVersion: $("#metaVersion"),
    metaValidity: $("#metaValidity"),
    searchInput: $("#searchInput"),
    trainList: $("#trainList"),
    emptyHint: $("#emptyHint"),
    trainEditor: $("#trainEditor"),
    trainNumber: $("#trainNumber"),
    isWeekdayOnly: $("#isWeekdayOnly"),
    isDirect: $("#isDirect"),
    stopsTbody: $("#stopsTbody"),
    validatePanel: $("#validatePanel"),
    btnLoadSamples: $("#btnLoadSamples"),
    fileInput: $("#fileInput"),
    btnValidate: $("#btnValidate"),
    btnSaveA: $("#btnSaveA"),
    btnSaveBoth: $("#btnSaveBoth"),
    btnUndo: $("#btnUndo"),
    btnRedo: $("#btnRedo"),
    btnAddTrain: $("#btnAddTrain"),
    btnAddStop: $("#btnAddStop"),
    btnAddTemplateStops: $("#btnAddTemplateStops"),
  };

  const STORAGE_KEY = "timetable_state_v1";

  // 方向 A 与 B 的端点与模板站序
  const TEMPLATE_STOPS_A = ["金山卫", "金山园区", "亭林", "叶榭", "车墩", "新桥", "春申","辛庄", "上海南"];
  const TEMPLATE_STOPS_B = [...TEMPLATE_STOPS_A].reverse();

  // 初始空集（用于新建/无数据时）
  const EMPTY_DATA = () => ({
    version: "1.0",
    validity: "",
    trains: [],
  });

  const state = {
    A: EMPTY_DATA(),
    B: EMPTY_DATA(),
    currentDir: "A",
    currentIndex: -1,
    history: [],
    future: [],
    fileHandleA: null,
    fileHandleB: null,
  };

  function getEndpointsForCurrentDir() {
    return state.currentDir === "A"
      ? { start: TEMPLATE_STOPS_A[0], end: TEMPLATE_STOPS_A[TEMPLATE_STOPS_A.length - 1] }
      : { start: TEMPLATE_STOPS_B[0], end: TEMPLATE_STOPS_B[TEMPLATE_STOPS_B.length - 1] };
  }
  function getTemplateStopsForCurrentDir() {
    return state.currentDir === "A" ? TEMPLATE_STOPS_A : TEMPLATE_STOPS_B;
  }

  // 深拷贝
  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function pushHistory() {
    // 存储 A/B + currentDir + currentIndex（避免历史过大，仍然可接受）
    const snapshot = {
      A: deepClone(state.A),
      B: deepClone(state.B),
      currentDir: state.currentDir,
      currentIndex: state.currentIndex,
    };
    state.history.push(JSON.stringify(snapshot));
    // 一旦有新操作，清空未来栈
    state.future = [];
    persistToLocal();
  }

  function undo() {
    if (!state.history.length) return;
    // 将当前快照推进 future
    const current = {
      A: deepClone(state.A),
      B: deepClone(state.B),
      currentDir: state.currentDir,
      currentIndex: state.currentIndex,
    };
    state.future.push(JSON.stringify(current));
    // 弹出历史并还原
    const prev = state.history.pop();
    const parsed = JSON.parse(prev);
    state.A = parsed.A;
    state.B = parsed.B;
    state.currentDir = parsed.currentDir;
    state.currentIndex = parsed.currentIndex;
    renderAll();
    persistToLocal();
  }

  function redo() {
    if (!state.future.length) return;
    // 当前推回 history
    const current = {
      A: deepClone(state.A),
      B: deepClone(state.B),
      currentDir: state.currentDir,
      currentIndex: state.currentIndex,
    };
    state.history.push(JSON.stringify(current));
    // 弹出 future 并还原
    const next = JSON.parse(state.future.pop());
    state.A = next.A;
    state.B = next.B;
    state.currentDir = next.currentDir;
    state.currentIndex = next.currentIndex;
    renderAll();
    persistToLocal();
  }

  function persistToLocal() {
    const payload = {
      A: state.A,
      B: state.B,
      currentDir: state.currentDir,
      currentIndex: state.currentIndex,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      // 忽略本地存储异常
    }
  }

  function restoreFromLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (parsed?.A?.trains && parsed?.B?.trains) {
        state.A = parsed.A;
        state.B = parsed.B;
        state.currentDir = parsed.currentDir || "A";
        state.currentIndex = typeof parsed.currentIndex === "number" ? parsed.currentIndex : -1;
        // 加载时压一层历史，便于撤销
        pushHistory();
        return true;
      }
    } catch (e) {}
    return false;
  }

  // ---------------------------
  // 时间处理与规范化
  // ---------------------------
  function isBlank(v) {
    return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  }

  function normalizeTime(input) {
    // 将 'nan'、空字符串、仅空白 => null
    if (input === null || input === undefined) return null;
    if (typeof input === "string") {
      const t = input.trim();
      if (!t || t.toLowerCase() === "nan") return null;

      // 接受 HH:mm 或 HH:mm:ss
      // 使用 dayjs + customParseFormat
      if (dayjs(t, "HH:mm:ss", true).isValid()) {
        // 已经标准化
        return t;
      }
      if (dayjs(t, "H:mm:ss", true).isValid()) {
        // 单数小时补零
        return dayjs(t, "H:mm:ss").format("HH:mm:ss");
      }
      if (dayjs(t, "HH:mm", true).isValid() || dayjs(t, "H:mm", true).isValid()) {
        // 自动补秒
        const d = dayjs(t, t.includes(":") && t.split(":")[0].length === 1 ? "H:mm" : "HH:mm");
        return d.format("HH:mm:ss");
      }
      // 其他格式无效 => 返回原值（交给校验提示错误）
      return t;
    }
    return null;
  }

  function timeToMinutes(t) {
    // 将 "HH:mm:ss" 转成分钟（忽略秒），用于比较
    if (!t || typeof t !== "string") return null;
    const m = dayjs(t, "HH:mm:ss", true);
    if (!m.isValid()) return null;
    const hh = parseInt(m.format("HH"), 10);
    const mm = parseInt(m.format("mm"), 10);
    return hh * 60 + mm;
  }

  // ---------------------------
  // 宽松时间解析与数值范围校验（新增）
  // ---------------------------
  function parseHmsLoose(str) {
    if (typeof str !== "string") return null;
    const t = str.trim();
    const m = t.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (!m) return null;
    return {
      h: parseInt(m[1], 10),
      m: parseInt(m[2], 10),
      s: m[3] != null ? parseInt(m[3], 10) : null,
    };
  }

  function isHmsInRange(c) {
    if (!c) return false;
    if (c.h < 0 || c.h > 23) return false;
    if (c.m < 0 || c.m > 59) return false;
    if (c.s != null && (c.s < 0 || c.s > 59)) return false;
    return true;
  }

  // ---------------------------
  // 校验规则（方案 A）
  // ---------------------------
  function validateTrain(train) {
    const msgs = [];
    const stops = train.stops || [];

    if (!Array.isArray(stops) || stops.length < 2) {
      msgs.push({ type: "error", text: "停站至少需要 2 条（首站与末站）。" });
      return msgs;
    }

    // 首末约束
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (first.arrivalTime !== null) {
      msgs.push({ type: "error", text: "首站到达时间必须为 null。" });
    }
    if (last.departureTime !== null) {
      msgs.push({ type: "error", text: "末站发车时间必须为 null。" });
    }

    // 直达约束
    if (train.isDirect) {
      if (stops.length !== 2) {
        msgs.push({ type: "error", text: "直达车次仅允许两站（首末站）。" });
      }
    }

    // 站名必填 & 时间格式
    stops.forEach((s, idx) => {
      if (isBlank(s.stationName)) {
        msgs.push({ type: "error", text: `第 ${idx + 1} 站：站名必填。` });
      }
      const at = s.arrivalTime;
      const dt = s.departureTime;

      // 到达/发车接收 null 或 "HH:mm:ss"。其他字符串提示错误
      if (typeof at === "string" && !dayjs(at, "HH:mm:ss", true).isValid()) {
        const loose = parseHmsLoose(at);
        if (loose) {
          if (!isHmsInRange(loose)) {
            msgs.push({ type: "warn", text: `第 ${idx + 1} 站：到达时间数值越界（小时0-23，分0-59，秒0-59）。` });
          } else {
            // 可被宽松解析且数值在范围内，交由规范化流程处理
          }
        } else {
          msgs.push({ type: "error", text: `第 ${idx + 1} 站：到达时间格式无效（需 HH:mm 或 HH:mm:ss 或留空）。` });
        }
      }
      if (typeof dt === "string" && !dayjs(dt, "HH:mm:ss", true).isValid()) {
        const loose = parseHmsLoose(dt);
        if (loose) {
          if (!isHmsInRange(loose)) {
            msgs.push({ type: "warn", text: `第 ${idx + 1} 站：发车时间数值越界（小时0-23，分0-59，秒0-59）。` });
          } else {
            // 可被宽松解析且数值在范围内，交由规范化流程处理
          }
        } else {
          msgs.push({ type: "error", text: `第 ${idx + 1} 站：发车时间格式无效（需 HH:mm 或 HH:mm:ss 或留空）。` });
        }
      }

      // 中间站仅到/仅发 -> 警告（允许）
      if (idx > 0 && idx < stops.length - 1) {
        if (at === null || dt === null) {
          msgs.push({ type: "warn", text: `第 ${idx + 1} 站：中间站仅到或仅发。` });
        }
      }

      // 同站内序（arrival <= departure）
      if (at && dt) {
        const aMin = timeToMinutes(at);
        const dMin = timeToMinutes(dt);
        if (aMin != null && dMin != null && aMin > dMin) {
          msgs.push({ type: "error", text: `第 ${idx + 1} 站：到达时间不得晚于发车时间。` });
        }
      }
    });

    // 跨站顺序（上一站 departure <= 下一站 arrival）
    for (let i = 0; i < stops.length - 1; i++) {
      const cur = stops[i];
      const nxt = stops[i + 1];
      const d = cur.departureTime;
      const a = nxt.arrivalTime;
      if (d && a) {
        const dMin = timeToMinutes(d);
        const aMin = timeToMinutes(a);
        if (dMin != null && aMin != null && dMin > aMin) {
          msgs.push({ type: "error", text: `第 ${i + 1} → 第 ${i + 2} 站：跨站时间倒序（发车晚于下站到达）。` });
        }
      } else {
        msgs.push({ type: "warn", text: `第 ${i + 1} → 第 ${i + 2} 站：时间不完整，无法校验跨站顺序。` });
      }
    }

    return msgs;
  }

  function normalizeDataset(data) {
    // 规范化时间、清理 'nan'/' ' 与首/末约束
    if (!data || !Array.isArray(data.trains)) return;
    data.trains.forEach((t) => {
      if (!Array.isArray(t.stops) || t.stops.length === 0) return;
      t.stops = t.stops.map((s) => ({
        stationName: typeof s.stationName === "string" ? s.stationName.trim() : s.stationName,
        arrivalTime: normalizeTime(s.arrivalTime),
        departureTime: normalizeTime(s.departureTime),
      }));
      // 应用首末约束
      t.stops[0].arrivalTime = null;
      t.stops[t.stops.length - 1].departureTime = null;
    });
  }

  // ---------------------------
  // 渲染
  // ---------------------------
  function getCurrentData() {
    return state.currentDir === "A" ? state.A : state.B;
  }

  function setCurrentDir(dir) {
    if (dir !== "A" && dir !== "B") return;
    // 切换前先同步未失焦的编辑
    syncEditorToState();
    state.currentDir = dir;
    state.currentIndex = -1;
    els.tabs.forEach((b) => b.classList.toggle("active", b.dataset.dir === dir));
    renderAll();
    persistToLocal();
  }

  function renderAll() {
    renderMeta();
    renderTrainList();
    renderEditor();
  }

  function renderMeta() {
    const data = getCurrentData();
    els.metaVersion.value = data.version || "";
    els.metaValidity.value = data.validity || "";
  }

  function renderTrainList() {
    const data = getCurrentData();
    const filter = (els.searchInput.value || "").trim().toLowerCase();

    // 重号统计
    const cnt = data.trains.reduce((acc, t) => {
      const key = (t.trainNumber || "").trim();
      if (!key) return acc;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    els.trainList.innerHTML = "";
    data.trains.forEach((t, idx) => {
      const num = (t.trainNumber || "").trim();
      if (filter && !num.toLowerCase().includes(filter)) return;

      const li = document.createElement("li");
      li.className = "train-item" + (idx === state.currentIndex ? " active" : "");
      li.addEventListener("click", () => {
        state.currentIndex = idx;
        renderAll();
        persistToLocal();
      });

      const left = document.createElement("div");
      left.className = "left";
      const numberSpan = document.createElement("span");
      numberSpan.className = "train-number";
      numberSpan.textContent = num || "(未命名)";

      left.appendChild(numberSpan);

      if (t.isDirect) {
        const b = document.createElement("span");
        b.className = "badge direct";
        b.textContent = "直达";
        left.appendChild(b);
      }
      if (t.isWeekdayOnly) {
        const b = document.createElement("span");
        b.className = "badge weekday";
        b.textContent = "工作日";
        left.appendChild(b);
      }
      if (num && cnt[num] > 1) {
        const b = document.createElement("span");
        b.className = "badge badge-dup";
        b.textContent = "重号";
        left.appendChild(b);
      }

      const actions = document.createElement("div");
      actions.className = "item-actions";

      const btnDel = document.createElement("button");
      btnDel.className = "icon-btn";
      btnDel.title = "删除车次";
      btnDel.textContent = "删除";
      btnDel.addEventListener("click", (e) => {
        e.stopPropagation();
        const ok = confirm(`确认删除车次 ${num || "(未命名)"} ?`);
        if (!ok) return;
        pushHistory();
        data.trains.splice(idx, 1);
        if (state.currentIndex === idx) state.currentIndex = -1;
        renderAll();
      });

      actions.appendChild(btnDel);

      li.appendChild(left);
      li.appendChild(actions);
      els.trainList.appendChild(li);
    });
  }

  function renderEditor() {
    const data = getCurrentData();
    const idx = state.currentIndex;
    if (idx < 0 || idx >= data.trains.length) {
      els.emptyHint.classList.remove("hidden");
      els.trainEditor.classList.add("hidden");
      return;
    }
    els.emptyHint.classList.add("hidden");
    els.trainEditor.classList.remove("hidden");

    const train = data.trains[idx];

    // 顶部字段
    els.trainNumber.value = train.trainNumber || "";
    els.isWeekdayOnly.checked = !!train.isWeekdayOnly;
    els.isDirect.checked = !!train.isDirect;

    // 停站表
    renderStopsTable(train);

    // 校验面板
    renderValidatePanel(train);
  }

  function renderStopsTable(train) {
    const stops = Array.isArray(train.stops) ? train.stops : [];
    els.stopsTbody.innerHTML = "";

    stops.forEach((s, i) => {
      const tr = document.createElement("tr");
      tr.setAttribute("draggable", "true");
      tr.dataset.index = String(i);
      tr.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData("text/plain", String(i));
        tr.classList.add("dragging");
      });
      tr.addEventListener("dragend", () => {
        tr.classList.remove("dragging");
      });
      tr.addEventListener("dragover", (e) => {
        e.preventDefault();
        tr.classList.add("drag-over");
      });
      tr.addEventListener("dragleave", () => {
        tr.classList.remove("drag-over");
      });
      tr.addEventListener("drop", (e) => {
        e.preventDefault();
        tr.classList.remove("drag-over");
        const fromStr = e.dataTransfer?.getData("text/plain");
        const from = fromStr ? parseInt(fromStr, 10) : NaN;
        const to = i;
        if (Number.isNaN(from) || from === to) return;
        pushHistory();
        const [moved] = stops.splice(from, 1);
        stops.splice(to, 0, moved);
        // 首末约束
        if (stops.length > 0) {
          stops[0].arrivalTime = null;
          stops[stops.length - 1].departureTime = null;
        }
        renderEditor();
        persistToLocal();
      });

      // 站名
      const tdStation = document.createElement("td");
      const inpStation = document.createElement("input");
      inpStation.type = "text";
      inpStation.value = s.stationName || "";
      inpStation.placeholder = "站名";
      inpStation.addEventListener("change", () => {
        pushHistory();
        s.stationName = inpStation.value.trim();
        persistToLocal();
        renderTrainList(); // 便于在列表中即时显示
      });
      tdStation.appendChild(inpStation);

      // 到达
      const tdArr = document.createElement("td");
      const inpArr = document.createElement("input");
      inpArr.type = "text";
      inpArr.value = s.arrivalTime == null ? "" : s.arrivalTime;
      inpArr.placeholder = "HH:mm或HH:mm:ss";
      const isFirst = i === 0;
      if (isFirst) {
        // 首站禁用到达
        tdArr.classList.add("cell-disabled");
        inpArr.disabled = true;
        inpArr.value = "";
      }
      inpArr.addEventListener("blur", () => {
        pushHistory();
        s.arrivalTime = normalizeTime(inpArr.value);
        if (i === 0) s.arrivalTime = null; // 强制
        inpArr.value = s.arrivalTime == null ? "" : s.arrivalTime;
        renderValidatePanel(train);
        persistToLocal();
      });
      tdArr.appendChild(inpArr);

      // 发车
      const tdDep = document.createElement("td");
      const inpDep = document.createElement("input");
      inpDep.type = "text";
      inpDep.value = s.departureTime == null ? "" : s.departureTime;
      inpDep.placeholder = "HH:mm或HH:mm:ss";
      const isLast = i === stops.length - 1;
      if (isLast) {
        // 末站禁用发车
        tdDep.classList.add("cell-disabled");
        inpDep.disabled = true;
        inpDep.value = "";
      }
      inpDep.addEventListener("blur", () => {
        pushHistory();
        s.departureTime = normalizeTime(inpDep.value);
        if (i === stops.length - 1) s.departureTime = null; // 强制
        inpDep.value = s.departureTime == null ? "" : s.departureTime;
        renderValidatePanel(train);
        persistToLocal();
      });
      tdDep.appendChild(inpDep);

      // 操作
      const tdOps = document.createElement("td");
      tdOps.className = "stop-ops";
      const btnUp = document.createElement("button");
      btnUp.className = "btn-sm btn-move";
      btnUp.textContent = "上移";
      btnUp.disabled = i === 0;
      btnUp.addEventListener("click", () => {
        pushHistory();
        arraySwap(stops, i, i - 1);
        // 重新应用首末禁用
        renderEditor();
        persistToLocal();
      });

      const btnDown = document.createElement("button");
      btnDown.className = "btn-sm btn-move";
      btnDown.textContent = "下移";
      btnDown.disabled = i === stops.length - 1;
      btnDown.addEventListener("click", () => {
        pushHistory();
        arraySwap(stops, i, i + 1);
        renderEditor();
        persistToLocal();
      });

      const btnInsert = document.createElement("button");
      btnInsert.className = "btn-sm";
      btnInsert.textContent = "插入下方";
      btnInsert.addEventListener("click", () => {
        pushHistory();
        stops.splice(i + 1, 0, {
          stationName: "",
          arrivalTime: null,
          departureTime: null,
        });
        renderEditor();
        persistToLocal();
      });

      const btnDel = document.createElement("button");
      btnDel.className = "btn-sm btn-danger";
      btnDel.textContent = "删除";
      btnDel.addEventListener("click", () => {
        if (stops.length <= 2) {
          alert("至少保留首末两站。");
          return;
        }
        pushHistory();
        stops.splice(i, 1);
        renderEditor();
        persistToLocal();
      });

      tdOps.appendChild(btnUp);
      tdOps.appendChild(btnDown);
      tdOps.appendChild(btnInsert);
      tdOps.appendChild(btnDel);

      tr.appendChild(tdStation);
      tr.appendChild(tdArr);
      tr.appendChild(tdDep);
      tr.appendChild(tdOps);
      els.stopsTbody.appendChild(tr);
    });
  }

  function renderValidatePanel(train) {
    const msgs = validateTrain(train);
    els.validatePanel.innerHTML = "";

    const title = document.createElement("div");
    title.className = "val-title";
    title.textContent = `校验结果（错误 ${msgs.filter(m => m.type === "error").length} / 警告 ${msgs.filter(m => m.type === "warn").length}）`;
    els.validatePanel.appendChild(title);

    msgs.forEach((m) => {
      const item = document.createElement("div");
      item.className = `val-item ${m.type}`;
      const tag = document.createElement("span");
      tag.className = `val-type ${m.type}`;
      tag.textContent = m.type === "error" ? "错误" : "警告";
      const txt = document.createElement("div");
      txt.className = "val-text";
      txt.textContent = m.text;
      item.appendChild(tag);
      item.appendChild(txt);
      els.validatePanel.appendChild(item);
    });
  }

  function arraySwap(arr, i, j) {
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }

  // ---------------------------
  // 将右侧编辑器未失焦的输入同步回 state（顶层字段 + 停站表）
  // ---------------------------
  function syncEditorToState() {
    const data = getCurrentData();
    const idx = state.currentIndex;
    if (!data || idx < 0 || idx >= (data.trains || []).length) return;
    const train = data.trains[idx];

    // 顶部字段
    if (els.trainNumber) {
      train.trainNumber = (els.trainNumber.value || "").trim();
    }
    if (els.isWeekdayOnly) {
      train.isWeekdayOnly = !!els.isWeekdayOnly.checked;
    }
    if (els.isDirect) {
      const newDirect = !!els.isDirect.checked;
      // 只同步勾选状态，不在此处做压缩/扩展，保持现有 change 逻辑的交互。
      train.isDirect = newDirect;
    }

    // 停站表
    const rows = Array.from(els.stopsTbody?.querySelectorAll("tr") || []);
    rows.forEach((tr, i) => {
      const inputs = tr.querySelectorAll("input");
      const [inpStation, inpArr, inpDep] = inputs;
      const s = train.stops && train.stops[i];
      if (!s) return;
      s.stationName = (inpStation?.value || "").trim();
      if (i === 0) {
        s.arrivalTime = null;
      } else {
        s.arrivalTime = normalizeTime(inpArr?.value ?? null);
      }
      if (i === rows.length - 1) {
        s.departureTime = null;
      } else {
        s.departureTime = normalizeTime(inpDep?.value ?? null);
      }
    });
  }

  // ---------------------------
  // JSON 输出（保证键顺序与缩进）
  // ---------------------------
  function formatDatasetForSave(data) {
    const out = {
      version: data.version || "",
      validity: data.validity || "",
      trains: (data.trains || []).map((t) => ({
        trainNumber: t.trainNumber || "",
        isWeekdayOnly: !!t.isWeekdayOnly,
        stops: (t.stops || []).map((s) => ({
          stationName: s.stationName || "",
          arrivalTime: s.arrivalTime === null ? null : s.arrivalTime,
          departureTime: s.departureTime === null ? null : s.departureTime,
        })),
        isDirect: !!t.isDirect,
      })),
    };
    return JSON.stringify(out, null, 2);
  }

  async function saveWithPicker(defaultName, jsonText, remember = null) {
    try {
      if ("showSaveFilePicker" in window) {
        const handle = await window.showSaveFilePicker({
          suggestedName: defaultName,
          types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(jsonText);
        await writable.close();
        if (remember === "A") state.fileHandleA = handle;
        if (remember === "B") state.fileHandleB = handle;
        alert(`已保存：${handle.name || defaultName}`);
        return true;
      }
    } catch (e) {
      // 用户取消或异常，继续走下载
    }
    // 降级下载
    const blob = new Blob([jsonText], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = defaultName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
    return true;
  }

  async function saveCurrentDir() {
    // 保存前同步编辑器内容
    syncEditorToState();
    const dir = state.currentDir;
    const data = dir === "A" ? state.A : state.B;
    // 规范化后保存
    normalizeDataset(data);
    const name = dir === "A" ? "金山卫-上海南.json" : "上海南-金山卫.json";
    const text = formatDatasetForSave(data);
    await saveWithPicker(name, text, dir);
  }

  async function saveBoth() {
    // 保存前同步编辑器内容
    syncEditorToState();
    // 分别生成两个下载
    normalizeDataset(state.A);
    normalizeDataset(state.B);
    const textA = formatDatasetForSave(state.A);
    const textB = formatDatasetForSave(state.B);
    await saveWithPicker("金山卫-上海南.json", textA, "A");
    await saveWithPicker("上海南-金山卫.json", textB, "B");
  }

  // ---------------------------
  // 事件绑定
  // ---------------------------
  function bindUI() {
    // Tab 切换
    els.tabs.forEach((b) => {
      b.addEventListener("click", () => setCurrentDir(b.dataset.dir));
    });

    // 元数据
    els.metaVersion.addEventListener("change", () => {
      pushHistory();
      getCurrentData().version = els.metaVersion.value;
      persistToLocal();
    });
    els.metaValidity.addEventListener("change", () => {
      pushHistory();
      getCurrentData().validity = els.metaValidity.value;
      persistToLocal();
    });

    // 搜索
    els.searchInput.addEventListener("input", () => renderTrainList());

    // 新建车次
    els.btnAddTrain.addEventListener("click", () => {
      // 新建前先提交当前编辑，避免丢输入
      syncEditorToState();
      pushHistory();
      const data = getCurrentData();
      const endpoints = getEndpointsForCurrentDir();
      data.trains.push({
        trainNumber: "",
        isWeekdayOnly: false,
        isDirect: false,
        stops: [
          { stationName: endpoints.start, arrivalTime: null, departureTime: null },
          { stationName: endpoints.end, arrivalTime: null, departureTime: null },
        ],
      });
      // 应用首末约束（首站 arrival=null，末站 departure=null）
      const t = data.trains[data.trains.length - 1];
      t.stops[0].arrivalTime = null;
      t.stops[t.stops.length - 1].departureTime = null;
      state.currentIndex = data.trains.length - 1;
      renderAll();
      persistToLocal();
      // 新建后自动聚焦到车次号
      setTimeout(() => {
        els.trainNumber?.focus?.();
        els.trainNumber?.select?.();
      }, 0);
    });

    // 添加停站（在末站前插入）
    els.btnAddStop.addEventListener("click", () => {
      // 修改结构前先提交当前编辑
      syncEditorToState();
      const data = getCurrentData();
      const idx = state.currentIndex;
      if (idx < 0) return;
      const train = data.trains[idx];
      if (!Array.isArray(train.stops) || train.stops.length < 1) return;
      pushHistory();
      const insertPos = Math.max(1, train.stops.length - 1);
      train.stops.splice(insertPos, 0, {
        stationName: "",
        arrivalTime: null,
        departureTime: null,
      });
      renderEditor();
      persistToLocal();
    });

    // 常用站模板（端点固定，中间填充模板）
    els.btnAddTemplateStops.addEventListener("click", () => {
      // 修改结构前先提交当前编辑
      syncEditorToState();
      const data = getCurrentData();
      const idx = state.currentIndex;
      if (idx < 0) return;
      const train = data.trains[idx];
      const template = getTemplateStopsForCurrentDir();
      pushHistory();
      // 用模板重建 stops：到达/发车均置空，首/末规则稍后强制
      train.stops = template.map((name, i) => ({
        stationName: name,
        arrivalTime: null,
        departureTime: null,
      }));
      // 应用首末约束
      train.stops[0].arrivalTime = null;
      train.stops[train.stops.length - 1].departureTime = null;
      renderEditor();
      persistToLocal();
    });

    // 车次顶部字段
    // 实时刷新左侧列表，但不加入历史，避免击键过多历史点
    els.trainNumber.addEventListener("input", () => {
      const data = getCurrentData();
      const idx = state.currentIndex;
      if (idx < 0) return;
      data.trains[idx].trainNumber = els.trainNumber.value.trim();
      renderTrainList();
    });
    // 结束编辑时再入历史并持久化
    els.trainNumber.addEventListener("blur", () => {
      const data = getCurrentData();
      const idx = state.currentIndex;
      if (idx < 0) return;
      pushHistory();
      data.trains[idx].trainNumber = els.trainNumber.value.trim();
      persistToLocal();
    });

    els.isWeekdayOnly.addEventListener("change", () => {
      const data = getCurrentData();
      const idx = state.currentIndex;
      if (idx < 0) return;
      pushHistory();
      data.trains[idx].isWeekdayOnly = !!els.isWeekdayOnly.checked;
      renderTrainList();
      persistToLocal();
    });

    els.isDirect.addEventListener("change", () => {
      const data = getCurrentData();
      const idx = state.currentIndex;
      if (idx < 0) return;
      const train = data.trains[idx];
      pushHistory();
      train.isDirect = !!els.isDirect.checked;

      // 若切换为直达且非两站，提示是否自动压缩为两站（保留端点）
      if (train.isDirect && train.stops.length !== 2) {
        const ok = confirm("直达仅允许两站，是否自动压缩为首末两站并清空中间站？");
        if (ok) {
          const first = train.stops[0];
          const last = train.stops[train.stops.length - 1];
          train.stops = [
            { stationName: first.stationName, arrivalTime: null, departureTime: first.departureTime ?? null },
            { stationName: last.stationName, arrivalTime: last.arrivalTime ?? null, departureTime: null },
          ];
          // 强制首末约束
          train.stops[0].arrivalTime = null;
          train.stops[1].departureTime = null;
        }
      }
      renderEditor();
      persistToLocal();
    });

    // 加载示例（尝试 fetch 当前目录两文件；若失败提示手动导入）
    els.btnLoadSamples.addEventListener("click", async () => {
      try {
        const [aRes, bRes] = await Promise.all([
          fetch("./金山卫-上海南.json").then((r) => r.ok ? r.json() : Promise.reject(new Error("fetch A failed"))),
          fetch("./上海南-金山卫.json").then((r) => r.ok ? r.json() : Promise.reject(new Error("fetch B failed"))),
        ]);
        pushHistory();
        state.A = aRes;
        state.B = bRes;
        normalizeDataset(state.A);
        normalizeDataset(state.B);
        state.currentDir = "A";
        state.currentIndex = -1;
        renderAll();
        persistToLocal();
        alert("示例数据已加载。");
      } catch (e) {
        alert("无法直接读取本地示例文件（浏览器限制）。请使用“导入数据…”按钮选择这两个 .json 文件导入。");
      }
    });

    // 导入数据（支持多选）
    els.fileInput.addEventListener("change", async (evt) => {
      const files = Array.from(evt.target.files || []);
      if (!files.length) return;
      for (const f of files) {
        try {
          const text = await f.text();
          const json = JSON.parse(text);
          if (!json || !Array.isArray(json.trains)) {
            alert(`文件 ${f.name} 格式不正确：缺少 trains 数组。`);
            continue;
          }
          normalizeDataset(json);
          const dir = detectDirection(json);
          pushHistory();
          if (dir === "A") {
            state.A = json;
            alert(`已导入至方向：金山卫 → 上海南（${f.name}）`);
          } else if (dir === "B") {
            state.B = json;
            alert(`已导入至方向：上海南 → 金山卫（${f.name}）`);
          } else {
            // 无法判断则导入当前方向
            const cur = state.currentDir === "A" ? "金山卫 → 上海南" : "上海南 → 金山卫";
            if (confirm(`无法从 ${f.name} 判断方向。是否导入到当前方向（${cur}）？`)) {
              if (state.currentDir === "A") state.A = json; else state.B = json;
            }
          }
          renderAll();
          persistToLocal();
        } catch (e) {
          alert(`文件 ${f.name} 解析失败：${e.message || e}`);
        }
      }
      // 清空 input 值，便于再次选择同一文件
      evt.target.value = "";
    });

    // 校验/规范化
    els.btnValidate.addEventListener("click", () => {
      // 先同步未失焦输入
      syncEditorToState();
      const data = getCurrentData();
      // 规范化当前方向
      pushHistory();
      normalizeDataset(data);
      renderAll();
      alert("已执行规范化（清理 'nan'/空白，补齐时间格式）并显示校验结果。");
    });

    // 保存
    els.btnSaveA.addEventListener("click", () => {
      saveCurrentDir();
    });
    els.btnSaveBoth.addEventListener("click", () => {
      saveBoth();
    });

    // 撤销/重做
    els.btnUndo.addEventListener("click", () => undo());
    els.btnRedo.addEventListener("click", () => redo());

    // 快捷键
    window.addEventListener("keydown", (e) => {
      const isMac = /Mac|iPhone|iPod|iPad/.test(navigator.platform);
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveCurrentDir();
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    });
  }

  // ---------------------------
  // 方向识别
  // ---------------------------
  function detectDirection(json) {
    try {
      const trains = json.trains || [];
      for (const t of trains) {
        const stops = t.stops || [];
        if (stops.length >= 2) {
          const first = (stops[0].stationName || "").trim();
          const last = (stops[stops.length - 1].stationName || "").trim();
          if (first === TEMPLATE_STOPS_A[0] && last === TEMPLATE_STOPS_A[TEMPLATE_STOPS_A.length - 1]) {
            return "A";
          }
          if (first === TEMPLATE_STOPS_B[0] && last === TEMPLATE_STOPS_B[TEMPLATE_STOPS_B.length - 1]) {
            return "B";
          }
        }
      }
    } catch (e) {}
    return null;
  }

  // ---------------------------
  // 启动
  // ---------------------------
  function init() {
    bindUI();
    const ok = restoreFromLocal();
    if (!ok) {
      // 初始空白，等待用户加载示例或导入
      renderAll();
    } else {
      renderAll();
    }
  }

  // 启动
  init();
})();
