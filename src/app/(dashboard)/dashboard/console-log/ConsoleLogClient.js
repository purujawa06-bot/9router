"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Card, Button, SegmentedControl } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

const LOG_LEVEL_COLORS = {
  LOG: "text-green-400",
  INFO: "text-blue-400",
  WARN: "text-yellow-400",
  ERROR: "text-red-400",
  DEBUG: "text-purple-400",
};

// Success = normal output (log + info); error/warn/debug map 1:1.
const FILTER_LEVELS = {
  SUCCESS: ["LOG", "INFO"],
  WARN: ["WARN"],
  ERROR: ["ERROR"],
  DEBUG: ["DEBUG"],
};

const FILTERS = [
  { value: "ALL", label: "All" },
  { value: "ERROR", label: "Error" },
  { value: "WARN", label: "Warn" },
  { value: "SUCCESS", label: "Success" },
  { value: "DEBUG", label: "Debug" },
];

// Normalize a log entry: buffer now sends { level, line, ts };
// tolerate legacy plain-string lines.
function normalizeEntry(entry) {
  if (typeof entry === "string") {
    const m = entry.match(/\[(LOG|INFO|WARN|ERROR|DEBUG)\]/i);
    return { level: (m?.[1] || "LOG").toUpperCase(), line: entry, ts: 0 };
  }
  return entry;
}

function colorLine(entry) {
  const { level, line } = normalizeEntry(entry);
  const color = LOG_LEVEL_COLORS[level] || "text-green-400";
  return <span className={color}>{line}</span>;
}

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const logRef = useRef(null);

  const handleClear = async () => {
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      // UI cleared via SSE "clear" event
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        setLogs(msg.logs.slice(-CONSOLE_LOG_CONFIG.maxLines));
      } else if (msg.type === "line") {
        setLogs((prev) => {
          const next = [...prev, msg.line];
          return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
        });
      } else if (msg.type === "lines") {
        setLogs((prev) => {
          const next = [...prev, ...msg.lines];
          return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
        });
      } else if (msg.type === "clear") {
        setLogs([]);
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // Counts per level + filtered view
  const { counts, visible } = useMemo(() => {
    const counts = { ALL: logs.length, ERROR: 0, WARN: 0, SUCCESS: 0, DEBUG: 0 };
    for (const entry of logs) {
      const { level } = normalizeEntry(entry);
      if (level === "ERROR") counts.ERROR++;
      else if (level === "WARN") counts.WARN++;
      else if (level === "DEBUG") counts.DEBUG++;
      else counts.SUCCESS++;
    }
    const visible =
      filter === "ALL"
        ? logs
        : logs.filter((entry) => FILTER_LEVELS[filter].includes(normalizeEntry(entry).level));
    return { counts, visible };
  }, [logs, filter]);

  const filterOptions = FILTERS.map((f) => ({
    ...f,
    label: `${f.label} (${counts[f.value]})`,
  }));

  return (
    <div className="">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2">
          <SegmentedControl options={filterOptions} value={filter} onChange={setFilter} size="sm" />
          <Button size="sm" variant="outline" icon="delete" onClick={handleClear}>
            Clear
          </Button>
        </div>
        <div
          ref={logRef}
          className="bg-black rounded-b-lg p-4 text-xs font-mono h-[calc(100vh-220px)] overflow-y-auto"
        >
          {visible.length === 0 ? (
            <span className="text-text-muted">
              {logs.length === 0 ? "No console logs yet." : `No ${filter.toLowerCase()} logs.`}
            </span>
          ) : (
            <div className="space-y-0.5">
              {visible.map((entry, i) => (
                <div key={i}>{colorLine(entry)}</div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
