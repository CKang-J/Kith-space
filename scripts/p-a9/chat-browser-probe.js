(() => {
  let observer;
  let mutation;
  let mark;

  function resetObservers() {
    observer?.disconnect();
    mutation?.disconnect();
    observer = undefined;
    mutation = undefined;
  }

  function observeLongTasks(target) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        target.push({ startTime: entry.startTime, duration: entry.duration });
      }
    });
    observer.observe({ type: "longtask" });
  }

  function inspectParagraphs(predicate) {
    for (const paragraph of document.querySelectorAll("p")) predicate(paragraph.textContent ?? "");
  }

  function settle(value) {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(value))));
  }

  function hasParagraph(targetText) {
    let found = false;
    inspectParagraphs((text) => { if (text === targetText) found = true; });
    return found;
  }

  function channelRow(channelName) {
    return [...document.querySelectorAll(".item.chan-row")].find((row) =>
      row.querySelector(".grow")?.textContent?.trim() === channelName,
    );
  }

  function navigateUntilVisible(channelName, targetText, timeoutMs) {
    const row = channelRow(channelName);
    if (!row) throw new Error(`P-A9 channel row missing: ${channelName}`);
    return new Promise((resolve, reject) => {
      const startedAt = performance.now();
      const deadline = startedAt + timeoutMs;
      let timer;
      const finish = () => {
        if (!hasParagraph(targetText)) return false;
        mutation?.disconnect();
        clearInterval(timer);
        resolve(performance.now() - startedAt);
        return true;
      };
      mutation = new MutationObserver(finish);
      mutation.observe(document.body, { childList: true, subtree: true, characterData: true });
      timer = setInterval(() => {
        if (finish()) return;
        if (performance.now() < deadline) return;
        mutation?.disconnect();
        clearInterval(timer);
        reject(new Error(`P-A9 render operation timed out for ${channelName}`));
      }, 10);
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      finish();
    });
  }

  globalThis.pA9BrowserProbe = {
    armRender(targetText) {
      resetObservers();
      mark = { kind: "render", startedAt: performance.now(), seenAt: null, longTasks: [] };
      observeLongTasks(mark.longTasks);
      const inspect = () => inspectParagraphs((text) => {
        if (mark.seenAt === null && text === targetText) {
          mark.seenAt = performance.now();
          mutation?.disconnect();
        }
      });
      mutation = new MutationObserver(inspect);
      mutation.observe(document.body, { childList: true, subtree: true, characterData: true });
      inspect();
      return mark.startedAt;
    },

    async readRender(timeoutMs = 15_000) {
      const deadline = performance.now() + timeoutMs;
      while (mark?.kind === "render" && mark.seenAt === null && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (mark?.kind !== "render" || mark.seenAt === null) throw new Error("P-A9 render mark timed out");
      return settle({
        latencyMs: mark.seenAt - mark.startedAt,
        longTasks: [...mark.longTasks],
        renderedArticles: document.querySelectorAll("article").length,
      });
    },

    async renderRound(channelTargets, operations = 100, timeoutMs = 15_000) {
      if (!Array.isArray(channelTargets) || channelTargets.length < 2) {
        throw new Error("P-A9 render round requires at least two channel targets");
      }
      resetObservers();
      const longTasks = [];
      const durationsMs = [];
      observeLongTasks(longTasks);
      let nextIndex = channelTargets.findIndex((target) => !hasParagraph(target.targetText));
      if (nextIndex < 0) nextIndex = 0;
      const startedAt = performance.now();
      for (let index = 0; index < operations; index += 1) {
        const target = channelTargets[(nextIndex + index) % channelTargets.length];
        if (!target?.channelName || !target?.targetText) throw new Error("P-A9 render target is incomplete");
        durationsMs.push(await navigateUntilVisible(target.channelName, target.targetText, timeoutMs));
        await settle(undefined);
      }
      observer?.disconnect();
      mutation?.disconnect();
      return {
        totalMs: performance.now() - startedAt,
        durationsMs,
        longTasks,
        renderedArticles: document.querySelectorAll("article").length,
      };
    },

    armRealtime(round, expectedCount = 100) {
      resetObservers();
      const prefix = `P-A9 realtime round ${round} message `;
      mark = {
        kind: "realtime",
        armedAt: performance.now(),
        firstSeenAt: null,
        completedAt: null,
        expectedCount,
        seen: new Set(),
        latencies: [],
        longTasks: [],
      };
      observeLongTasks(mark.longTasks);
      const inspect = () => {
        inspectParagraphs((text) => {
          if (!text.startsWith(prefix)) return;
          const match = /message (\d+) \| sentAt=(\d+)$/.exec(text);
          if (!match) return;
          const number = Number(match[1]);
          if (mark.seen.has(number)) return;
          if (mark.firstSeenAt === null) mark.firstSeenAt = performance.now();
          mark.seen.add(number);
          mark.latencies.push({ number, latencyMs: Date.now() - Number(match[2]) });
        });
        if (mark.seen.size >= mark.expectedCount) {
          mark.completedAt = performance.now();
          mutation?.disconnect();
        }
      };
      mutation = new MutationObserver(inspect);
      mutation.observe(document.body, { childList: true, subtree: true, characterData: true });
      inspect();
      return mark.armedAt;
    },

    async readRealtime(timeoutMs = 15_000) {
      const deadline = performance.now() + timeoutMs;
      while (mark?.kind === "realtime" && mark.completedAt === null && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (mark?.kind !== "realtime" || mark.completedAt === null || mark.firstSeenAt === null) {
        throw new Error(`P-A9 realtime mark timed out at ${mark?.seen?.size ?? 0} messages`);
      }
      return settle({
        latenciesMs: [...mark.latencies].sort((left, right) => left.number - right.number).map((entry) => entry.latencyMs),
        batchApplyMs: mark.completedAt - mark.firstSeenAt,
        longTasks: [...mark.longTasks],
        renderedArticles: document.querySelectorAll("article").length,
      });
    },

    async loadHistory(expectedArticles, selector = "div.scroll.ch-view-enter", timeoutMs = 30_000) {
      const container = document.querySelector(selector);
      if (!container) throw new Error(`P-A9 message scroll container missing: ${selector}`);
      const deadline = performance.now() + timeoutMs;
      let prior = 0;
      while (performance.now() < deadline) {
        const current = document.querySelectorAll("article").length;
        if (current >= expectedArticles) return { articles: current, scrollHeight: container.scrollHeight };
        container.scrollTop = 1;
        container.dispatchEvent(new Event("scroll", { bubbles: true }));
        container.scrollTop = 0;
        container.dispatchEvent(new Event("scroll", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, current === prior ? 250 : 100));
        prior = current;
      }
      throw new Error(`P-A9 history load timed out at ${document.querySelectorAll("article").length} articles`);
    },

    async scrollRound(operations = 100, selector = "div.scroll.ch-view-enter") {
      const container = document.querySelector(selector);
      if (!container) throw new Error(`P-A9 message scroll container missing: ${selector}`);
      resetObservers();
      const longTasks = [];
      const durationsMs = [];
      observeLongTasks(longTasks);
      const startedAt = performance.now();
      for (let index = 0; index < operations; index += 1) {
        const operationStartedAt = performance.now();
        container.scrollTop = index % 2 === 0 ? 0 : Math.max(0, container.scrollHeight - container.clientHeight);
        container.dispatchEvent(new Event("scroll", { bubbles: true }));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        durationsMs.push(performance.now() - operationStartedAt);
      }
      await settle(undefined);
      observer?.disconnect();
      return {
        totalMs: performance.now() - startedAt,
        durationsMs,
        longTasks,
        renderedArticles: document.querySelectorAll("article").length,
        scrollHeight: container.scrollHeight,
      };
    },

    cleanup() {
      resetObservers();
      mark = undefined;
    },
  };
})();
