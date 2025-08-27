(() => {
  // ---------------------------
  // 基础选择器
  // ---------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const els = {
    tabs: $$(".tabs .tab"),
    fileInput: $("#fileInput"),
    statsText: $("#statsText"),
    tbody: $("#tbody"),
    headSortables: Array.from(document.querySelectorAll(".board-table thead th.sortable")),
  };

  // ---------------------------
  // 常量与状态
  // ---------------------------
  const TEMPLATE_STOPS_A = ["金山卫", "金山园区", "亭林", "叶榭", "车墩", "新桥", "春申", "辛庄", "上海南"];
  const TEMPLATE_STOPS_B = [...TEMPLATE_STOPS_A].reverse();

  const state = {
    A: null, // {version, validity, trains: [...]}
    B: null,
    currentDir: "A",
    sort: { by: "dep", order: "asc" }, // by: dep|trainNumber|arr|stopsCount|duration
  };

  // ---------------------------
  // 工具函数（只读版）
  // ---------------------------
  function isBlank(v) {
    return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  }

  function normalizeTime(input) {
    if (input === null || input === undefined) return null;
    if (typeof input === "string") {
      const t = input.trim();
      if (!t || t.toLowerCase() === "nan") return null;

      if (dayjs(t, "HH:mm:ss", true).isValid()) {
        return t;
      }
      if (dayjs(t, "H:mm:ss", true).isValid()) {
        return dayjs(t, "H:mm:ss").format("HH:mm:ss");
      }
      if (dayjs(t, "HH:mm", true).isValid() || dayjs(t, "H:mm", true).isValid()) {
        const d = dayjs(t, t.includes(":") && t.split(":")[0].length === 1 ? "H:mm" : "HH:mm");
        return d.format("HH:mm:ss");
      }
      return t; // 其它格式原样返回（渲染时会显示为 "—"）
    }
    return null;
  }

  function timeToMinutes(t) {
    if (!t || typeof t !== "string") return null;
    const m = dayjs(t, "HH:mm:ss", true);
    if (!m.isValid()) return null;
    const hh = parseInt(m.format("HH"), 10);
    const mm = parseInt(m.format("mm"), 10);
    return hh * 60 + mm;
  }

  function normalizeDataset(data) {
    if (!data || !Array.isArray(data.trains)) return;
    data.trains.forEach((t) => {
      if (!Array.isArray(t.stops) || t.stops.length === 0) return;
      t.stops = t.stops.map((s) => ({
        stationName: typeof s.stationName === "string" ? s.stationName.trim() : s.stationName,
        arrivalTime: normalizeTime(s.arrivalTime),
        departureTime: normalizeTime(s.departureTime),
      }));
      // 强制首/末约束
      t.stops[0].arrivalTime = null;
      t.stops[t.stops.length - 1].departureTime = null;
    });
  }

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

  function formatTimeShort(t) {
    // 显示为 HH:mm；非法/空则返回 "—"
    if (!t || typeof t !== "string") return "—";
    const d = dayjs(t, "HH:mm:ss", true);
    if (!d.isValid()) return "—";
    return d.format("HH:mm");
  }

  function formatDuration(mins) {
    if (mins == null || !Number.isFinite(mins) || mins < 0) return "—";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `${h} 小时 ${m} 分`;
    return `${m} 分`;
  }

  // ---------------------------
  // 派生行与排序
  // ---------------------------
  function getCurrentData() {
    return state.currentDir === "A" ? state.A : state.B;
  }

  function deriveRows(dataset) {
    if (!dataset || !Array.isArray(dataset.trains)) return [];
    return dataset.trains.map((t) => {
      const stops = Array.isArray(t.stops) ? t.stops : [];
      const first = stops[0] || {};
      const last = stops[stops.length - 1] || {};
      const dep = first.departureTime || null;
      const arr = last.arrivalTime || null;
      const depMin = timeToMinutes(dep);
      const arrMin = timeToMinutes(arr);
      const duration = depMin != null && arrMin != null ? arrMin - depMin : null;

      return {
        trainNumber: (t.trainNumber || "").trim(),
        isDirect: !!t.isDirect,
        isWeekdayOnly: !!t.isWeekdayOnly,
        startName: first.stationName || "",
        endName: last.stationName || "",
        dep,
        arr,
        depMin,
        arrMin,
        stopsCount: stops.length,
        duration: duration != null && duration >= 0 ? duration : null,
      };
    });
  }

  function sortRows(rows) {
    const { by, order } = state.sort;
    const asc = order === "asc";
    const factor = asc ? 1 : -1;

    function cmp(a, b) {
      let av, bv;
      switch (by) {
        case "dep":
          av = a.depMin; bv = b.depMin;
          break;
        case "arr":
          av = a.arrMin; bv = b.arrMin;
          break;
        case "duration":
          av = a.duration; bv = b.duration;
          break;
        case "stopsCount":
          av = a.stopsCount; bv = b.stopsCount;
          break;
        case "trainNumber":
          av = (a.trainNumber || "").toLowerCase();
          bv = (b.trainNumber || "").toLowerCase();
          break;
        default:
          av = 0; bv = 0;
      }

      // 数值空值处理：升序时空值视为 Infinity（排底），降序时为 -Infinity（排底）
      if (typeof av === "number" && typeof bv === "number") {
        if (!Number.isFinite(av)) av = asc ? Infinity : -Infinity;
        if (!Number.isFinite(bv)) bv = asc ? Infinity : -Infinity;
      } else if (typeof av === "number" && typeof bv !== "number") {
        bv = asc ? Infinity : -Infinity;
      } else if (typeof bv === "number" && typeof av !== "number") {
        av = asc ? Infinity : -Infinity;
      }

      if (av < bv) return -1 * factor;
      if (av > bv) return 1 * factor;
      // 次级排序：发车时间 -> 车次号
      if (by !== "dep") {
        if ((a.depMin ?? Infinity) !== (b.depMin ?? Infinity)) {
          return ((a.depMin ?? Infinity) - (b.depMin ?? Infinity)) * factor;
        }
      }
      return (a.trainNumber || "").localeCompare(b.trainNumber || "", "zh-CN") * factor;
    }

    rows.sort(cmp);
    return rows;
  }

  function updateSortIndicators() {
    els.headSortables.forEach((th) => {
      th.classList.remove("sorted-asc", "sorted-desc");
      const key = th.getAttribute("data-key");
      if (key === state.sort.by) {
        th.classList.add(state.sort.order === "asc" ? "sorted-asc" : "sorted-desc");
      }
    });
  }

  // ---------------------------
  // 渲染
  // ---------------------------
  function renderStats() {
    const aCount = state.A?.trains?.length ?? 0;
    const bCount = state.B?.trains?.length ?? 0;
    const cur = state.currentDir;
    const curCount = cur === "A" ? aCount : bCount;

    if (!aCount && !bCount) {
      els.statsText.textContent = "尚未加载数据";
      return;
    }
    if (aCount && bCount) {
      els.statsText.textContent = `已加载：A ${aCount} 班；B ${bCount} 班。当前方向：${cur}（${curCount} 班）`;
    } else if (aCount) {
      els.statsText.textContent = `已加载：A ${aCount} 班。当前方向：A`;
    } else {
      els.statsText.textContent = `已加载：B ${bCount} 班。当前方向：B`;
    }
  }

  function renderTabs() {
    els.tabs.forEach((b) => b.classList.toggle("active", b.dataset.dir === state.currentDir));
  }

  function renderTable() {
    const data = getCurrentData();
    if (!data || !Array.isArray(data.trains) || data.trains.length === 0) {
      els.tbody.innerHTML = `<tr><td class="empty-hint td-center" colspan="8">当前方向暂无数据，请导入 JSON。</td></tr>`;
      return;
    }

    const rows = sortRows(deriveRows(data));
    let html = "";
    for (const r of rows) {
      const depTxt = formatTimeShort(r.dep);
      const arrTxt = formatTimeShort(r.arr);
      const typeHtml = r.isDirect
        ? '<span class="badge direct">直达</span>'
        : '<span class="badge via">经停</span>';
      const durationTxt = formatDuration(r.duration);

      html += `
        <tr>
          <td>${depTxt}</td>
          <td class="td-train">${escapeHtml(r.trainNumber || "")}</td>
          <td>${typeHtml}</td>
          <td>${escapeHtml(r.startName || "")}</td>
          <td>${escapeHtml(r.endName || "")}</td>
          <td>${arrTxt}</td>
          <td class="td-center">${Number.isFinite(r.stopsCount) ? r.stopsCount : "—"}</td>
          <td class="td-right">${durationTxt}</td>
        </tr>
      `;
    }
    els.tbody.innerHTML = html;
  }

  function renderAll() {
    renderTabs();
    renderStats();
    updateSortIndicators();
    renderTable();
  }

  // 简单 HTML 转义，避免意外字符影响布局（顺序需先 & 再其他）
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------------------------
  // 事件绑定
  // ---------------------------
  function bindUI() {
    // 方向切换
    els.tabs.forEach((b) => {
      b.addEventListener("click", () => {
        const dir = b.dataset.dir === "B" ? "B" : "A";
        if (state.currentDir !== dir) {
          state.currentDir = dir;
          renderAll();
        }
      });
    });

    // 列头排序
    els.headSortables.forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-key");
        if (!key) return;
        if (state.sort.by === key) {
          state.sort.order = state.sort.order === "asc" ? "desc" : "asc";
        } else {
          state.sort.by = key;
          state.sort.order = key === "trainNumber" ? "asc" : "asc";
        }
        renderAll();
      });
    });

    // 导入数据
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
          if (dir === "A") {
            state.A = json;
          } else if (dir === "B") {
            state.B = json;
          } else {
            const cur = state.currentDir === "A" ? "金山卫 → 上海南" : "上海南 → 金山卫";
            const ok = confirm(`无法从 ${f.name} 判断方向。是否导入到当前方向（${cur}）？`);
            if (ok) {
              if (state.currentDir === "A") state.A = json; else state.B = json;
            }
          }
        } catch (e) {
          alert(`文件 ${f.name} 解析失败：${e.message || e}`);
        }
      }

      // 清空选择，便于重复导入相同文件
      evt.target.value = "";
      renderAll();
    });
  }

  // ---------------------------
  // 启动
  // ---------------------------
  function init() {
    bindUI();
    renderAll();
  }

  init();
})();
