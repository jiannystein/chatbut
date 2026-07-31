import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowSquareOut,
  Bug,
  BookmarkSimple,
  CalendarBlank,
  CaretRight,
  ChatCircleDots,
  ChatsCircle,
  CheckCircle,
  Clock,
  Database,
  DownloadSimple,
  Eye,
  EyeSlash,
  FileArrowUp,
  Globe,
  Hash,
  HourglassMedium,
  Info,
  Key,
  List,
  LockKey,
  MagnifyingGlass,
  Play,
  Plus,
  ShieldCheck,
  SpinnerGap,
  Stop,
  Trash,
  User,
  UserPlus,
  UsersThree,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/manrope";
import {
  DAY_OPTIONS,
  DEFAULT_CONFIG,
  MAX_SCHEDULE_WINDOWS,
  formatClock,
  formatDayRange,
  formatSchedule,
  isScheduleActive,
  nextWindowLabel,
  normalizeConfig,
  validateConfig,
} from "./config.js";
import {
  clearDebugLog,
  createLocalConfig,
  exportConfigFile,
  exportDebugLog,
  getDebugLogStatus,
  importConfigFile,
  loadLocalConfig,
  saveLocalConfig,
} from "./file-store.js";
import { fuzzyScore, normalizeConversationLabel } from "./bookmarklet/core.js";

const GOOGLE_CHAT_URL = "https://chat.google.com/app/home";
const PAIRING_TOKEN_KEY = "chatbut-pairing-token";
const PAIRING_TOKEN_PLACEHOLDER = "__CHATBUT_PAIRING_TOKEN__";
const BRIDGE_URL_PLACEHOLDER = "__CHATBUT_BRIDGE_URL__";
const PROVIDERS = [
  { id: "deepseek", label: "DeepSeek", hint: "Default" },
  { id: "openai", label: "OpenAI", hint: "OpenAI API" },
  { id: "anthropic", label: "Claude", hint: "Anthropic API" },
  { id: "kimi-global", label: "Kimi Global", hint: "moonshot.ai" },
  { id: "kimi-china", label: "Kimi China", hint: "moonshot.cn" },
];

const NAV_ITEMS = [
  { id: "window", label: "Window", Icon: Clock },
  { id: "people", label: "People", Icon: UsersThree },
  { id: "replies", label: "Replies", Icon: ChatsCircle },
  { id: "safety", label: "Safety", Icon: ShieldCheck },
];

function makeDefaultConfig() {
  return normalizeConfig(DEFAULT_CONFIG);
}

function getOrCreatePairingToken() {
  let existing = "";
  try {
    existing = localStorage.getItem(PAIRING_TOKEN_KEY) ?? "";
  } catch {
    // A session-only token still supports the current open configurator.
  }
  if (/^[A-Za-z0-9_-]{32,128}$/.test(existing ?? "")) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  try {
    localStorage.setItem(PAIRING_TOKEN_KEY, token);
  } catch {
    // Reinstalling the bookmark after a reload repairs session-only pairing.
  }
  return token;
}

function InlineNotice({ tone = "info", children }) {
  const Icon = tone === "error" || tone === "warning" ? WarningCircle : Info;
  return (
    <div className={`notice notice--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon size={20} weight="bold" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

function Button({
  children,
  tone = "secondary",
  icon: Icon,
  loading = false,
  success = false,
  ...props
}) {
  return (
    <button
      className={`button button--${tone}`}
      data-state={loading ? "loading" : success ? "success" : "default"}
      {...props}
    >
      {loading ? (
        <SpinnerGap className="spin" size={20} weight="bold" aria-hidden="true" />
      ) : success ? (
        <CheckCircle size={20} weight="bold" aria-hidden="true" />
      ) : Icon ? (
        <Icon size={20} weight="bold" aria-hidden="true" />
      ) : null}
      <span>{children}</span>
    </button>
  );
}

function Toggle({ checked, onChange, label, description, disabled = false }) {
  return (
    <label className={`toggle-row${disabled ? " is-disabled" : ""}`}>
      <span className="toggle-copy">
        <strong>{label}</strong>
        {description ? <span>{description}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span className="toggle" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
    </label>
  );
}

function InfoTip({ children }) {
  return (
    <span className="info-tip">
      <button type="button" aria-label="More information">
        <Info size={17} weight="bold" aria-hidden="true" />
      </button>
      <span role="tooltip">{children}</span>
    </span>
  );
}

function BookmarkletLink({ href, disabled = false }) {
  const anchorRef = useRef(null);
  useEffect(() => {
    anchorRef.current?.setAttribute("href", href);
  }, [href]);
  return (
    <a
      ref={anchorRef}
      className={`button button--primary install-strip__button${disabled ? " is-disabled" : ""}`}
      href="#install-chatbut"
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={(event) => event.preventDefault()}
      onDragStart={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData("text/uri-list", href);
        event.dataTransfer.setData("text/plain", href);
      }}
      draggable={disabled ? "false" : "true"}
      title={disabled ? "Create or import a configuration first" : "Drag this button to the Chrome bookmarks bar"}
    >
      <span aria-hidden="true">💬</span>
      <span>Chatbut</span>
    </a>
  );
}

function FieldRow({ Icon, label, value, onClick, tone = "support" }) {
  const content = (
    <>
      <span className={`field-row__icon field-row__icon--${tone}`}>
        <Icon size={24} weight="regular" aria-hidden="true" />
      </span>
      <span className="field-row__copy">
        <strong>{label}</strong>
        <span>{value}</span>
      </span>
      {onClick ? <CaretRight size={20} weight="bold" aria-hidden="true" /> : null}
    </>
  );
  return onClick ? (
    <button type="button" className="field-row" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="field-row">{content}</div>
  );
}

function AppHeader({ configured, saveStatus, onImport, onCreate, onExport }) {
  return (
    <header className="masthead">
      <div className="brand" aria-label="Chatbut">
        <img src="./assets/chatbut-mark.png" alt="" width="48" height="48" />
        <span>Chatbut</span>
      </div>
      <div className="masthead__file">
        <Database size={20} weight="regular" aria-hidden="true" />
        <span className={`status-dot${configured ? "" : " status-dot--idle"}`} aria-hidden="true" />
        <span className="masthead__filename">
          {configured ? "Browser-local configuration" : "No local configuration"}
        </span>
        <span className="masthead__local">· This Chrome profile</span>
        {configured && saveStatus === "saving" ? <span className="dirty-badge">Saving</span> : null}
        {configured && saveStatus === "saved" ? <span className="saved-badge">Saved</span> : null}
      </div>
      <div className="masthead__actions">
        <Button icon={FileArrowUp} onClick={onImport}>Import</Button>
        <Button icon={Plus} onClick={onCreate}>{configured ? "Reset" : "Create"}</Button>
        <Button
          icon={DownloadSimple}
          tone="support"
          onClick={onExport}
          disabled={!configured}
        >
          Export
        </Button>
      </div>
    </header>
  );
}

function Sidebar({ active, onChange, ready }) {
  return (
    <aside className="sidebar" aria-label="Configuration sections">
      <nav className="sidebar__nav">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={`nav-item${active === id ? " is-active" : ""}`}
            onClick={() => onChange(id)}
            aria-current={active === id ? "page" : undefined}
          >
            <Icon size={24} weight={active === id ? "bold" : "regular"} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar__status">
        <span className={`status-dot${ready ? "" : " status-dot--idle"}`} aria-hidden="true" />
        <strong>{ready ? "Ready" : "Setup needed"}</strong>
        <span>{ready ? "Configuration can be saved." : "Complete the checks to continue."}</span>
      </div>
    </aside>
  );
}

function DaySelector({ days, onChange }) {
  return (
    <fieldset className="day-selector">
      <legend>Active days</legend>
      <div className="day-selector__grid">
        {DAY_OPTIONS.map((day) => {
          const selected = days.includes(day.value);
          return (
            <label key={day.value} className={selected ? "is-selected" : ""}>
              <input
                type="checkbox"
                checked={selected}
                onChange={() => {
                  const next = selected
                    ? days.filter((value) => value !== day.value)
                    : [...days, day.value];
                  onChange(next);
                }}
              />
              <span>{day.short}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Timeline({ schedule }) {
  const window = schedule.windows[0] ?? { start: "06:00", end: "08:00" };
  const labels = useMemo(() => {
    const [startHour, startMinute] = window.start.split(":").map(Number);
    const [endHour, endMinute] = window.end.split(":").map(Number);
    const start = startHour * 60 + startMinute;
    let end = endHour * 60 + endMinute;
    if (end <= start) end += 24 * 60;
    const duration = end - start;
    return Array.from({ length: 5 }, (_, index) => {
      const minutes = start + Math.round((duration * index) / 4);
      const wrapped = minutes % (24 * 60);
      return {
        position: `${(index / 4) * 100}%`,
        label: formatClock(
          `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`,
        ),
      };
    });
  }, [window.end, window.start]);

  return (
    <div className="timeline" aria-label={`First window from ${formatClock(window.start)} to ${formatClock(window.end)}`}>
      <div className="timeline__rail" aria-hidden="true">
        <span className="timeline__endpoint timeline__endpoint--start" />
        <span className="timeline__endpoint timeline__endpoint--end" />
      </div>
      <div className="timeline__ticks" aria-hidden="true">
        {labels.map((tick, index) => (
          <span key={`${tick.label}-${index}`} style={{ insetInlineStart: tick.position }}>
            <i />
            <b>{tick.label}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function ScheduleTimeInput({ id, label, value, onCommit }) {
  const [draft, setDraft] = useState(value);
  const [touched, setTouched] = useState(false);
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(draft);
  const descriptionId = `${id}-description`;

  useEffect(() => {
    setDraft(value);
    setTouched(false);
  }, [value]);

  function commit() {
    setTouched(true);
    if (!valid) return;
    onCommit(draft);
    setTouched(false);
  }

  return (
    <label className="schedule-time-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck="false"
        maxLength="5"
        pattern="([01]\d|2[0-3]):[0-5]\d"
        value={draft}
        aria-invalid={touched && !valid}
        aria-describedby={descriptionId}
        placeholder="HH:MM"
        onChange={(event) => {
          setDraft(event.target.value.replace(/[^\d:]/g, "").slice(0, 5));
          if (touched) setTouched(false);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(value);
            setTouched(false);
            event.currentTarget.blur();
          }
        }}
      />
      <small id={descriptionId}>
        {touched && !valid ? "Use 24-hour time, for example 18:30." : "24-hour time · HH:MM"}
      </small>
    </label>
  );
}

function OverlayPreview({ nextWindow, scheduleLabel, withinSchedule }) {
  return (
    <aside className="overlay-frame" aria-label="Google Chat widget preview">
      <div className="overlay-frame__heading">
        <span className="overlay-frame__label">Google Chat widget</span>
        <span className="preview-badge">Preview only</span>
      </div>
      <div className="overlay-panel" aria-disabled="true">
        <div className="overlay-panel__header">
          <strong>Chatbut</strong>
          <span>Disabled</span>
        </div>
        <p className="overlay-panel__status">Ready in the dedicated automation tab.</p>
        <dl className="overlay-metrics">
          <div><dt>Replies</dt><dd>0</dd></div>
          <div><dt>Chats</dt><dd>0</dd></div>
          <div><dt>Pending</dt><dd>0</dd></div>
        </dl>
        <div className="overlay-panel__actions">
          <Button tone="support" icon={Play} disabled>Enable</Button>
          <Button tone="danger" icon={Stop} disabled>Stop</Button>
        </div>
        <span className="overlay-panel__reassurance">
          {withinSchedule ? scheduleLabel : nextWindow} · Session safety limit 20
        </span>
      </div>
    </aside>
  );
}

function WindowPanel({
  config,
  setConfig,
  setActiveSection,
  configured,
  bookmarkletHref,
  onOpenGoogleChat,
}) {
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [editingDelay, setEditingDelay] = useState(false);
  const activeNow = isScheduleActive(config);
  const scheduleLabel = formatSchedule(config);

  function updateSchedule(key, value) {
    setConfig((current) => ({
      ...current,
      schedule: { ...current.schedule, [key]: value },
    }));
  }

  function updateWindow(index, key, value) {
    updateSchedule("windows", config.schedule.windows.map((window, windowIndex) => (
      windowIndex === index ? { ...window, [key]: value } : window
    )));
  }

  function updateDelay(key, value) {
    setConfig((current) => ({
      ...current,
      delays: { ...current.delays, [key]: Number(value) },
    }));
  }

  return (
    <section className="workspace workspace--window" aria-labelledby="window-heading">
      <div className="window-main">
        <div className="section-heading">
          <div>
            <h1 id="window-heading">Your response window</h1>
            <p>Set when Chatbut may acknowledge new eligible messages.</p>
          </div>
          <span className={`schedule-state${activeNow ? " is-active" : ""}`}>
            {activeNow ? "Window open" : "Window closed"}
          </span>
        </div>

        <section className="install-strip" aria-labelledby="install-heading">
          <span className="install-strip__icon">
            <BookmarkSimple size={25} weight="fill" aria-hidden="true" />
          </span>
          <div className="install-strip__copy">
            <strong id="install-heading">Install once, click in Chat</strong>
            <span>Drag 💬 Chatbut to the Chrome bookmarks bar. Open Google Chat, then click it to start a dedicated automation tab.</span>
          </div>
          <div className="install-strip__actions">
            {bookmarkletHref ? (
              <BookmarkletLink href={bookmarkletHref} disabled={!configured} />
            ) : (
              <span className="install-strip__loading">
                <SpinnerGap className="spin" size={20} weight="bold" aria-hidden="true" />
                Preparing bookmarklet
              </span>
            )}
            <Button
              icon={ArrowSquareOut}
              tone="support"
              onClick={onOpenGoogleChat}
              disabled={!configured}
            >
              Open Google Chat
            </Button>
          </div>
        </section>

        <div className="window-clock" aria-hidden="true">
          <strong>{formatClock(config.schedule.windows[0]?.start ?? "06:00")}</strong>
          <span>{formatDayRange(config.schedule.days)}</span>
          <strong>{formatClock(config.schedule.windows[0]?.end ?? "08:00")}</strong>
        </div>

        <Timeline schedule={config.schedule} />

        <div className="settings-list">
          <FieldRow
            Icon={CalendarBlank}
            label="Schedule"
            value={config.schedule.windows.length > 1
              ? `${config.schedule.windows.length} windows · ${formatDayRange(config.schedule.days)}`
              : scheduleLabel}
            onClick={() => setEditingSchedule((current) => !current)}
          />
          {editingSchedule ? (
            <div className="window-editor">
              <DaySelector days={config.schedule.days} onChange={(days) => updateSchedule("days", days)} />
              <div className="schedule-windows">
                {config.schedule.windows.map((window, index) => (
                  <div className="time-fields time-fields--window" key={`${window.start}-${window.end}-${index}`}>
                    <ScheduleTimeInput
                      id={`window-${index + 1}-start`}
                      label={`Window ${index + 1} start`}
                      value={window.start}
                      onCommit={(value) => updateWindow(index, "start", value)}
                    />
                    <ScheduleTimeInput
                      id={`window-${index + 1}-end`}
                      label={`Window ${index + 1} end`}
                      value={window.end}
                      onCommit={(value) => updateWindow(index, "end", value)}
                    />
                    <button
                      type="button"
                      className="icon-button icon-button--danger"
                      aria-label={`Remove response window ${index + 1}`}
                      disabled={config.schedule.windows.length === 1}
                      onClick={() => updateSchedule("windows", config.schedule.windows.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      <Trash size={20} weight="regular" aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <Button
                  icon={Plus}
                  disabled={config.schedule.windows.length >= MAX_SCHEDULE_WINDOWS}
                  onClick={() => updateSchedule("windows", [
                    ...config.schedule.windows,
                    { start: "16:00", end: "18:00" },
                  ])}
                >
                  Add window
                </Button>
              </div>
            </div>
          ) : null}
          <FieldRow
            Icon={User}
            label="Direct messages"
            value={`${config.targeting.directExclusions.length} excluded · group DMs need a mention`}
            onClick={() => setActiveSection("people")}
          />
          <FieldRow
            Icon={Hash}
            label="Spaces"
            value={`${config.targeting.selectedGroups.length} selected ${config.targeting.selectedGroups.length === 1 ? "space" : "spaces"}`}
            onClick={() => setActiveSection("people")}
          />
          <FieldRow
            Icon={ChatCircleDots}
            label="First acknowledgement"
            value={`Vault 1 · ${config.responses.vault1.length} responses`}
            onClick={() => setActiveSection("replies")}
          />
          <FieldRow
            Icon={Clock}
            label={`Follow-up after ${config.delays.followUpMinutes} min`}
            value={`Vault 2 · ${config.responses.vault2.length} responses`}
            onClick={() => setActiveSection("replies")}
          />
          <FieldRow
            Icon={HourglassMedium}
            label="Reply delay"
            value={`${config.delays.minimumSeconds}–${config.delays.maximumSeconds} sec`}
            onClick={() => setEditingDelay((current) => !current)}
          />
          {editingDelay ? (
            <div className="delay-editor">
              <label>
                <span>Minimum seconds</span>
                <input
                  type="number"
                  min="1"
                  max="3600"
                  value={config.delays.minimumSeconds}
                  onChange={(event) => updateDelay("minimumSeconds", event.target.value)}
                />
              </label>
              <span className="range-separator">–</span>
              <label>
                <span>Maximum seconds</span>
                <input
                  type="number"
                  min={config.delays.minimumSeconds}
                  max="3600"
                  value={config.delays.maximumSeconds}
                  onChange={(event) => updateDelay("maximumSeconds", event.target.value)}
                />
              </label>
            </div>
          ) : null}
        </div>
      </div>

      <OverlayPreview
        nextWindow={nextWindowLabel(config)}
        scheduleLabel={scheduleLabel}
        withinSchedule={activeNow}
      />
    </section>
  );
}

const TARGET_KIND_COPY = {
  direct: { label: "1:1 direct", Icon: User },
  "group-direct": { label: "Group DM", Icon: UsersThree },
  space: { label: "Space", Icon: Hash },
};

function inferredTargetKind(item, source) {
  if (item.kind) return item.kind;
  if (source === "space") return "space";
  return item.id.startsWith("dm/") ? "direct" : "group-direct";
}

function TargetManager({ config, setConfig }) {
  const [query, setQuery] = useState("");
  const indexed = config.targeting.indexedChats;
  const merged = useMemo(() => {
    const byId = new Map(indexed.map((item) => [item.id, item]));
    for (const item of config.targeting.directExclusions) {
      if (!byId.has(item.id)) byId.set(item.id, { ...item, kind: inferredTargetKind(item, "direct") });
    }
    for (const item of config.targeting.selectedGroups) {
      if (!byId.has(item.id)) byId.set(item.id, { ...item, kind: inferredTargetKind(item, "space") });
    }
    return [...byId.values()];
  }, [config.targeting.directExclusions, config.targeting.indexedChats, config.targeting.selectedGroups]);
  const directExclusions = new Set(config.targeting.directExclusions.map((item) => item.id));
  const selectedGroups = new Set(config.targeting.selectedGroups.map((item) => item.id));
  const normalizedQuery = query.trim();
  const results = merged
    .map((item, index) => ({
      ...item,
      label: normalizeConversationLabel(item.label),
      customized: item.kind === "space" ? selectedGroups.has(item.id) : directExclusions.has(item.id),
      score: fuzzyScore(normalizedQuery, item.label),
      index,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (!normalizedQuery && a.customized !== b.customized) return a.customized ? -1 : 1;
      return b.score - a.score || a.index - b.index;
    })
    .slice(0, 12);

  function toggle(item) {
    setConfig((current) => {
      const listName = item.kind === "space" ? "selectedGroups" : "directExclusions";
      const list = current.targeting[listName];
      const exists = list.some((entry) => entry.id === item.id);
      return {
        ...current,
        targeting: {
          ...current.targeting,
          [listName]: exists
            ? list.filter((entry) => entry.id !== item.id)
            : [...list, { id: item.id, label: item.label, kind: item.kind }],
        },
      };
    });
  }

  return (
    <section className="target-manager" aria-labelledby="target-manager-heading">
      <div className="editor-section__heading">
        <div>
          <h2 id="target-manager-heading">Recent Google Chat conversations</h2>
          <p>Search the locally indexed list, then change only the exceptions.</p>
        </div>
        <span className="count-badge">{indexed.length}</span>
      </div>
      <label className="search-field">
        <span>Find a conversation</span>
        <span className="input-shell">
          <MagnifyingGlass size={20} weight="regular" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search recent chats and spaces"
          />
        </span>
      </label>
      <p className="search-results-count" aria-live="polite">
        {results.length} {results.length === 1 ? "conversation" : "conversations"} shown
      </p>
      {results.length ? (
        <ul className="conversation-list">
          {results.map((item) => {
            const kind = TARGET_KIND_COPY[item.kind] ?? TARGET_KIND_COPY.direct;
            const excluded = directExclusions.has(item.id);
            const selected = selectedGroups.has(item.id);
            const state = item.kind === "space"
              ? selected ? "Included" : "Off"
              : excluded
                ? "Excluded"
                : item.kind === "group-direct" ? "Mentions and replies" : "Auto reply";
            const action = item.kind === "space"
              ? selected ? "Remove" : "Include"
              : excluded ? "Allow" : "Exclude";
            const Icon = kind.Icon;
            return (
              <li key={item.id}>
                <span className="conversation-list__icon">
                  <Icon size={20} weight="regular" aria-hidden="true" />
                </span>
                <span className="conversation-list__copy">
                  <strong>{item.label}</strong>
                  <span>{kind.label} · {state}</span>
                </span>
                <button type="button" onClick={() => toggle(item)}>
                  {action}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty-state">
          <MagnifyingGlass size={32} weight="regular" aria-hidden="true" />
          <strong>{normalizedQuery ? "No recent chats match" : "No conversations indexed yet"}</strong>
          <span>
            {normalizedQuery
              ? "Try a shorter name."
              : "Run 💬 Chatbut once in Google Chat. Recent conversations will appear here automatically."}
          </span>
        </div>
      )}
    </section>
  );
}

function PolicySummary({ config }) {
  const directCount = config.targeting.directExclusions.filter(
    (item) => inferredTargetKind(item, "direct") === "direct",
  ).length;
  const groupCount = config.targeting.directExclusions.filter(
    (item) => inferredTargetKind(item, "direct") === "group-direct",
  ).length;
  return (
    <div className="policy-band">
      <div>
        <User size={24} weight="regular" aria-hidden="true" />
        <span><strong>1:1 direct messages</strong>Auto reply · {directCount} excluded</span>
      </div>
      <div>
        <UsersThree size={24} weight="regular" aria-hidden="true" />
        <span><strong>Multi-person DMs</strong>Mentions and replies · {groupCount} excluded</span>
      </div>
      <div>
        <Hash size={24} weight="regular" aria-hidden="true" />
        <span><strong>Spaces</strong>Opt-in · {config.targeting.selectedGroups.length} selected</span>
      </div>
    </div>
  );
}

function PeoplePanel({ config, setConfig }) {
  return (
    <section className="workspace workspace--editor" aria-labelledby="people-heading">
      <div className="section-heading section-heading--wide">
        <div>
          <h1 id="people-heading">Choose who receives replies</h1>
          <p>Chatbut handles normal direct messages automatically. Group conversations respond only when you are mentioned or directly replied to.</p>
        </div>
      </div>
      <PolicySummary config={config} />
      <TargetManager config={config} setConfig={setConfig} />
      <InlineNotice>
        The recent-chat index contains conversation names and stable IDs only. It is refreshed locally when the bookmark connects.
      </InlineNotice>
    </section>
  );
}

function VaultEditor({ title, description, items, onChange }) {
  function updateItem(index, value) {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? value : item)));
  }
  function removeItem(index) {
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
  }
  return (
    <section className="editor-section vault">
      <div className="editor-section__heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="count-badge">{items.length}</span>
      </div>
      <div className="vault__items">
        {items.map((item, index) => (
          <div className="vault-item" key={`${title}-${index}`}>
            <label>
              <span>Response {index + 1}</span>
              <textarea
                value={item}
                onChange={(event) => updateItem(index, event.target.value)}
                rows="3"
              />
            </label>
            <button
              type="button"
              className="icon-button icon-button--danger"
              onClick={() => removeItem(index)}
              aria-label={`Remove response ${index + 1} from ${title}`}
              disabled={items.length === 1}
            >
              <Trash size={20} weight="regular" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <Button
        icon={Plus}
        onClick={() => onChange([...items, ""])}
        disabled={items.length >= 50}
      >
        Add response
      </Button>
    </section>
  );
}

function RepliesPanel({
  config,
  setConfig,
  setMessage,
  onValidateProvider,
}) {
  const [providerId, setProviderId] = useState("deepseek");
  const [secret, setSecret] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [validationState, setValidationState] = useState("idle");

  function updateLlm(key, value) {
    setConfig((current) => ({ ...current, llm: { ...current.llm, [key]: value } }));
  }

  function saveValidatedConnection(validatedProviderId, apiKey, model) {
    setConfig((current) => {
      const withoutProvider = current.llm.connections.filter(
        (connection) => connection.providerId !== validatedProviderId,
      );
      const connection = {
        providerId: validatedProviderId,
        apiKey,
        model,
        status: "validated",
        validatedAt: new Date().toISOString(),
        error: "",
      };
      return {
        ...current,
        llm: {
          ...current.llm,
          connections: [...withoutProvider, connection],
          activeProviderId: current.llm.activeProviderId || validatedProviderId,
        },
      };
    });
  }

  async function validateAndSave(targetProviderId = providerId, apiKey = secret) {
    setValidationState("validating");
    setMessage(null);
    try {
      const result = await onValidateProvider(targetProviderId, apiKey);
      saveValidatedConnection(targetProviderId, apiKey, result.model);
      setValidationState("valid");
      setSecret("");
      const label = PROVIDERS.find((provider) => provider.id === targetProviderId)?.label ?? "Provider";
      setMessage({ tone: "info", text: `${label} validated with ${result.model}. The connection was saved locally.` });
    } catch (error) {
      setValidationState("invalid");
      setSecret("");
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "LLM validation failed." });
    }
  }

  function deleteConnection(targetProviderId) {
    setConfig((current) => {
      const connections = current.llm.connections.filter(
        (connection) => connection.providerId !== targetProviderId,
      );
      return {
        ...current,
        llm: {
          ...current.llm,
          connections,
          activeProviderId: current.llm.activeProviderId === targetProviderId
            ? connections[0]?.providerId ?? ""
            : current.llm.activeProviderId,
          enabled: connections.length ? current.llm.enabled : false,
        },
      };
    });
  }

  const selectedProvider = PROVIDERS.find((provider) => provider.id === providerId);

  return (
    <section className="workspace workspace--editor" aria-labelledby="replies-heading">
      <div className="section-heading section-heading--wide">
        <div>
          <h1 id="replies-heading">Keep replies human and bounded</h1>
          <p>Chatbut randomly selects a saved response. An optional LLM can adapt the wording without changing its acknowledge-and-defer intent.</p>
        </div>
      </div>

      <section className="api-panel">
        <div className="api-panel__heading">
          <span className="api-panel__icon"><Key size={24} weight="regular" aria-hidden="true" /></span>
          <div>
            <h2>LLM connections</h2>
            <p>Bring your own provider key. Chatbut discovers a suitable text model, runs a small completion, and saves only validated connections.</p>
          </div>
          <span className={`validation-badge validation-badge--${config.llm.enabled ? "valid" : "disabled"}`}>
            {config.llm.enabled ? "Adaptation on" : "Optional · off"}
          </span>
        </div>
        <Toggle
          checked={config.llm.enabled}
          onChange={(enabled) => updateLlm("enabled", enabled)}
          label={config.llm.enabled ? "LLM adaptation enabled" : "Use saved responses only"}
          description="Turning this off keeps saved connections but sends the selected vault response unchanged."
        />

        <div className="provider-workflow" aria-label="Add an LLM connection">
          <label>
            <span>Provider</span>
            <select
              value={providerId}
              onChange={(event) => {
                setProviderId(event.target.value);
                setSecret("");
                setValidationState("idle");
              }}
            >
              {PROVIDERS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}{provider.hint ? ` · ${provider.hint}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="secret-field">
            <span>{selectedProvider?.label} API key</span>
            <span className="input-shell">
              <LockKey size={20} weight="regular" aria-hidden="true" />
              <input
                type={showKey ? "text" : "password"}
                value={secret}
                onChange={(event) => {
                  setSecret(event.target.value);
                  setValidationState("idle");
                }}
                placeholder="Paste provider key"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowKey((current) => !current)}
                aria-label={showKey ? "Hide API key" : "Show API key"}
              >
                {showKey ? <EyeSlash size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
              </button>
            </span>
          </label>
          <Button
            tone="support"
            icon={Key}
            onClick={() => validateAndSave()}
            loading={validationState === "validating"}
            success={validationState === "valid"}
            disabled={!secret || validationState === "validating"}
          >
            {validationState === "valid" ? "Connection saved" : "Validate and save"}
          </Button>
        </div>
        <p className="provider-cost-note">
          Validation lists the models available to your key and sends one minimal completion, which may use a small number of billable tokens.
        </p>

        <fieldset className="provider-connections">
          <legend>Saved connections</legend>
          {config.llm.connections.length ? config.llm.connections.map((connection) => {
            const provider = PROVIDERS.find((item) => item.id === connection.providerId);
            const active = config.llm.activeProviderId === connection.providerId;
            const needsAttention = connection.status !== "validated";
            return (
              <div className={`provider-connection${needsAttention ? " has-error" : ""}`} key={connection.providerId}>
                <label>
                  <input
                    type="radio"
                    name="active-llm-provider"
                    value={connection.providerId}
                    checked={active}
                    onChange={() => updateLlm("activeProviderId", connection.providerId)}
                  />
                  <span className="provider-connection__copy">
                    <strong>{provider?.label ?? connection.providerId}</strong>
                    <span>{needsAttention ? connection.error || "Needs attention" : connection.model}</span>
                  </span>
                  <span className={`connection-state${needsAttention ? " is-error" : ""}`}>
                    {needsAttention ? "Needs attention" : active ? "Active" : "Saved"}
                  </span>
                </label>
                <div className="provider-connection__actions">
                  {needsAttention ? (
                    <Button
                      onClick={() => validateAndSave(connection.providerId, connection.apiKey)}
                      loading={validationState === "validating"}
                    >
                      Retry
                    </Button>
                  ) : null}
                  <button
                    type="button"
                    className="icon-button icon-button--danger"
                    onClick={() => deleteConnection(connection.providerId)}
                    aria-label={`Delete ${provider?.label ?? connection.providerId} connection`}
                  >
                    <Trash size={20} weight="regular" aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          }) : (
            <div className="provider-empty">
              <Key size={24} weight="regular" aria-hidden="true" />
              <span><strong>No LLM connections saved</strong>Add a key above, or keep using saved responses only.</span>
            </div>
          )}
        </fieldset>

        <div className="api-panel__options">
          <label>
            <span>Recent messages sent for context</span>
            <input
              type="number"
              min="3"
              max="10"
              value={config.llm.recentMessageCount}
              onChange={(event) => updateLlm("recentMessageCount", Number(event.target.value))}
            />
          </label>
          <label>
            <span>Reply language</span>
            <select
              value={config.llm.language}
              onChange={(event) => updateLlm("language", event.target.value)}
            >
              <option value="en">English</option>
              <option value="zh">Chinese</option>
            </select>
          </label>
          <div className="bounded-copy">
            <CheckCircle size={20} weight="bold" aria-hidden="true" />
            <span>Acknowledge and defer · maximum two sentences · fallback to the saved response</span>
          </div>
        </div>
      </section>

      <div className="editor-grid editor-grid--vaults">
        <VaultEditor
          title="Vault 1"
          description="First acknowledgement after the randomized delay."
          items={config.responses.vault1}
          onChange={(vault1) => setConfig((current) => ({
            ...current,
            responses: { ...current.responses, vault1 },
          }))}
        />
        <VaultEditor
          title="Vault 2"
          description={`One follow-up after ${config.delays.followUpMinutes} minutes and a new eligible message.`}
          items={config.responses.vault2}
          onChange={(vault2) => setConfig((current) => ({
            ...current,
            responses: { ...current.responses, vault2 },
          }))}
        />
      </div>

      <label className="cooldown-field">
        <span>Vault 2 cooldown</span>
        <span className="input-suffix">
          <input
            type="number"
            min="1"
            max="1440"
            value={config.delays.followUpMinutes}
            onChange={(event) => setConfig((current) => ({
              ...current,
              delays: { ...current.delays, followUpMinutes: Number(event.target.value) },
            }))}
          />
          <span>minutes</span>
        </span>
      </label>
    </section>
  );
}

function SafetyPanel({
  config,
  setConfig,
  setMessage,
}) {
  const [logStatus, setLogStatus] = useState({ bytes: 0, sequence: 1 });

  useEffect(() => {
    getDebugLogStatus().then(setLogStatus).catch(() => {});
  }, [config.debug.enabled]);

  async function exportLogs() {
    try {
      await exportDebugLog();
      setMessage({ tone: "info", text: "The current debug log was exported." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The debug log could not be exported." });
    }
  }

  async function startNewLog() {
    try {
      await clearDebugLog();
      setLogStatus(await getDebugLogStatus());
      setMessage({ tone: "info", text: "A new empty debug log is ready." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The debug log could not be reset." });
    }
  }

  return (
    <section className="workspace workspace--editor" aria-labelledby="safety-heading">
      <div className="section-heading section-heading--wide">
        <div>
          <h1 id="safety-heading">Local by design, explicit by default</h1>
          <p>Nothing runs until you click the bookmarklet and enable inside a valid scheduled window.</p>
        </div>
      </div>

      <div className="safety-grid">
        <section className="editor-section">
          <div className="editor-section__heading">
            <div>
              <h2>Runtime guardrails</h2>
              <p>Applied before every automated send.</p>
            </div>
            <ShieldCheck size={28} weight="regular" aria-hidden="true" />
          </div>
          <ul className="check-list">
            <li><CheckCircle size={20} weight="bold" aria-hidden="true" />Only new messages after enable</li>
            <li><CheckCircle size={20} weight="bold" aria-hidden="true" />Stop outside the configured window</li>
            <li><CheckCircle size={20} weight="bold" aria-hidden="true" />Stop a conversation after a manual reply</li>
            <li><CheckCircle size={20} weight="bold" aria-hidden="true" />Skip uncertain message or composer states</li>
            <li><CheckCircle size={20} weight="bold" aria-hidden="true" />No normal-operation activity log</li>
          </ul>
        </section>

        <section className="editor-section">
          <div className="editor-section__heading">
            <div>
              <h2>Invitation handling</h2>
              <p>Optional acceptance during an enabled schedule only.</p>
            </div>
            <UserPlus size={28} weight="regular" aria-hidden="true" />
          </div>
          <div className="toggle-stack">
            <div className="toggle-with-tip">
              <Toggle
                checked={config.invitations.autoAcceptDirect}
                onChange={(autoAcceptDirect) => setConfig((current) => ({
                  ...current,
                  invitations: { ...current.invitations, autoAcceptDirect },
                }))}
                label="Auto-accept human 1:1 requests"
                description="Bots and apps are excluded. The request message becomes eligible after acceptance."
              />
              <InfoTip>Off by default. Accepting a request changes your Google Chat state and may expose read status.</InfoTip>
            </div>
            <div className="toggle-with-tip">
              <Toggle
                checked={config.invitations.autoAcceptSpaces}
                onChange={(autoAcceptSpaces) => setConfig((current) => ({
                  ...current,
                  invitations: { ...current.invitations, autoAcceptSpaces },
                }))}
                label="Auto-accept Space invitations"
                description="Newly joined Spaces are added to the allowlist; only @mentions and direct replies qualify."
              />
              <InfoTip>Off by default. Chatbut never joins a Space outside the configured schedule.</InfoTip>
            </div>
          </div>
        </section>

        <section className="editor-section">
          <div className="editor-section__heading">
            <div>
              <h2>Debug logging</h2>
              <p>Off by default. Full chat context may appear in debug files.</p>
            </div>
            <Bug size={28} weight="regular" aria-hidden="true" />
          </div>
          <Toggle
            checked={config.debug.enabled}
            onChange={(enabled) => setConfig((current) => ({
              ...current,
              debug: { ...current.debug, enabled },
            }))}
            label={config.debug.enabled ? "Debug logging enabled" : "Debug logging disabled"}
            description="Logs rotate after 10 MB; credentials are always redacted."
          />
          {config.debug.enabled ? (
            <div className="debug-folder">
              <div>
                <Database size={22} weight="regular" aria-hidden="true" />
                <span>
                  <strong>{Math.round((logStatus.bytes || 0) / 1024).toLocaleString()} KB stored</strong>
                  <small>Log {String(logStatus.sequence || 1).padStart(3, "0")} · rotates at 10 MB</small>
                </span>
              </div>
              <Button icon={DownloadSimple} onClick={exportLogs}>Export log</Button>
              <Button icon={Plus} onClick={startNewLog}>Start new</Button>
            </div>
          ) : null}
        </section>
      </div>

      <InlineNotice tone="warning">
        This proof of concept stores provider keys in plaintext inside this Chrome profile and exported JSON backups. Anyone with profile or backup access can read them. Sending work messages to an LLM provider must also be allowed by your organization.
      </InlineNotice>

      <section className="local-summary">
        <Globe size={24} weight="regular" aria-hidden="true" />
        <div>
          <strong>Browser timezone</strong>
          <span>{Intl.DateTimeFormat().resolvedOptions().timeZone || "Browser local time"}</span>
        </div>
        <LockKey size={24} weight="regular" aria-hidden="true" />
        <div>
          <strong>Storage</strong>
          <span>Browser-local IndexedDB · manual JSON export</span>
        </div>
      </section>
    </section>
  );
}

export function App() {
  const [activeSection, setActiveSection] = useState("window");
  const [config, setConfigState] = useState(makeDefaultConfig);
  const [configured, setConfigured] = useState(false);
  const [storageLoading, setStorageLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [message, setMessage] = useState(null);
  const [bookmarkletHref, setBookmarkletHref] = useState("");
  const [pairingToken] = useState(getOrCreatePairingToken);
  const bridgePortRef = useRef(null);
  const validationRequestsRef = useRef(new Map());
  const importInputRef = useRef(null);
  const configRef = useRef(config);
  configRef.current = config;

  const validation = useMemo(() => validateConfig(config), [config]);
  function setConfig(updater) {
    setConfigState((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      return normalizeConfig(next);
    });
  }

  useEffect(() => {
    let cancelled = false;
    fetch("./chatbut-bookmarklet.txt")
      .then((response) => {
        if (!response.ok) throw new Error("Bookmarklet artifact is unavailable.");
        return response.text();
      })
      .then((value) => {
        if (!cancelled) {
          const bridgeUrl = new URL("./chatbut-bridge.html", window.location.href).href;
          setBookmarkletHref(
            value.trim()
              .replace(PAIRING_TOKEN_PLACEHOLDER, pairingToken)
              .replace(BRIDGE_URL_PLACEHOLDER, encodeURIComponent(bridgeUrl)),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setMessage({ tone: "error", text: "The bookmarklet could not be prepared. Reload this page or check the deployment." });
      });
    loadLocalConfig()
      .then((record) => {
        if (cancelled) return;
        if (record) {
          setConfigState(record.config);
          setConfigured(true);
          setMessage({ tone: "info", text: "Your browser-local configuration was loaded." });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage({ tone: "error", text: error instanceof Error ? error.message : "Browser-local storage could not be read." });
        }
      })
      .finally(() => {
        if (!cancelled) setStorageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pairingToken]);

  useEffect(() => {
    if (typeof SharedWorker !== "function") {
      setMessage({
        tone: "error",
        text: "This Chrome profile blocks the local tab bridge. Chatbut cannot connect safely.",
      });
      return undefined;
    }

    let worker;
    try {
      worker = new SharedWorker("./chatbut-bridge-worker.js", {
        name: "chatbut-config-bridge",
      });
    } catch {
      setMessage({
        tone: "error",
        text: "Chrome could not start the local tab bridge. Reload this page or review managed-browser policy.",
      });
      return undefined;
    }
    const port = worker.port;
    bridgePortRef.current = port;
    port.start();
    port.postMessage({
      type: "chatbut:register",
      role: "configurator",
      token: pairingToken,
    });

    function handleBridgeMessage(event) {
      const data = event.data;
      if (!data || typeof data !== "object" || typeof data.type !== "string") return;
      if (data.type === "chatbut:config-changed" && data.config) {
        const nextConfig = normalizeConfig(data.config);
        if (JSON.stringify(nextConfig) !== JSON.stringify(configRef.current)) {
          setConfigState(nextConfig);
        }
        return;
      }
      if (data.requestId && validationRequestsRef.current.has(data.requestId)) {
        const pending = validationRequestsRef.current.get(data.requestId);
        validationRequestsRef.current.delete(data.requestId);
        window.clearTimeout(pending.timer);
        if (data.type === "chatbut:provider-valid") {
          pending.resolve({ model: data.model });
        } else if (data.type === "chatbut:provider-invalid" || data.type === "chatbut:error") {
          pending.reject(new Error(String(data.message || "Provider validation failed.")));
        }
      }
    }

    port.addEventListener("message", handleBridgeMessage);
    return () => {
      port.removeEventListener("message", handleBridgeMessage);
      port.close();
      if (bridgePortRef.current === port) bridgePortRef.current = null;
    };
  }, [pairingToken]);

  useEffect(() => {
    if (!configured || storageLoading) return undefined;
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      saveLocalConfig(config, pairingToken)
        .then(() => {
          bridgePortRef.current?.postMessage({
            type: "chatbut:config-app-saved",
            config,
          });
          setSaveStatus("saved");
        })
        .catch((error) => {
          setSaveStatus("error");
          setMessage({ tone: "error", text: error instanceof Error ? error.message : "The local configuration could not be saved." });
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [config, configured, pairingToken, storageLoading]);

  function validateProvider(providerId, apiKey) {
    return new Promise((resolve, reject) => {
      const port = bridgePortRef.current;
      if (!port) {
        reject(new Error("The local provider bridge is not ready. Reload Chatbut and retry."));
        return;
      }
      const requestId = crypto.randomUUID();
      const timer = window.setTimeout(() => {
        validationRequestsRef.current.delete(requestId);
        reject(new Error("Provider validation timed out. Check the network and retry."));
      }, 45_000);
      validationRequestsRef.current.set(requestId, { resolve, reject, timer });
      port.postMessage({
        type: "chatbut:validate-provider",
        requestId,
        providerId,
        apiKey,
      });
    });
  }

  async function handleCreate() {
    if (configured && !window.confirm("Replace the current browser-local configuration with the defaults? Export a backup first if you need it.")) {
      return;
    }
    setMessage(null);
    try {
      const nextConfig = makeDefaultConfig();
      await createLocalConfig(nextConfig, pairingToken);
      setConfigState(nextConfig);
      setConfigured(true);
      setSaveStatus("saved");
      setMessage({ tone: "info", text: "Created the browser-local configuration. Review the settings, then install the bookmark." });
      setActiveSection("window");
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Unable to create the configuration." });
    }
  }

  async function handleImportFile(event) {
    const [file] = event.target.files ?? [];
    event.target.value = "";
    if (!file) return;
    if (configured && !window.confirm("Replace the current browser-local configuration with this JSON backup?")) return;
    try {
      const record = await importConfigFile(file, pairingToken);
      setConfigState(record.config);
      setConfigured(true);
      setSaveStatus("saved");
      setMessage({
        tone: "info",
        text: record.config.llm.connections.length
          ? "Imported the backup. Validate imported LLM connections in this Chrome profile before enabling adaptation."
          : "Imported the backup into browser-local storage.",
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Unable to import the configuration." });
    }
  }

  async function handleOpenGoogleChat() {
    if (!configured) {
      setMessage({ tone: "warning", text: "Create or import a local configuration first." });
      return;
    }
    if (!validation.valid) {
      setMessage({ tone: "warning", text: validation.errors.join(" ") });
      return;
    }
    const chatWindow = window.open(
      GOOGLE_CHAT_URL,
      "chatbut-google-chat",
    );
    if (!chatWindow) {
      setMessage({ tone: "error", text: "Chrome blocked the Google Chat tab. Allow this site to open it, then try again." });
      return;
    }
    chatWindow.focus();

    try {
      await saveLocalConfig(config, pairingToken);
      setMessage({
        tone: "info",
        text: "Google Chat opened in the Chatbut-managed tab. Click the Chatbut bookmark there; this configurator may now be closed.",
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not save the configuration before opening Google Chat.",
      });
    }
  }

  return (
    <div className="app-shell">
      <AppHeader
        configured={configured}
        saveStatus={saveStatus}
        onImport={() => importInputRef.current?.click()}
        onCreate={handleCreate}
        onExport={() => exportConfigFile(config)}
      />
      <Sidebar
        active={activeSection}
        onChange={setActiveSection}
        ready={validation.valid && configured}
      />
      <main className="app-main">
        <input
          ref={importInputRef}
          className="visually-hidden"
          type="file"
          accept=".json,.chatbut,application/json"
          aria-hidden="true"
          tabIndex="-1"
          onChange={handleImportFile}
        />
        {!storageLoading && !configured ? (
          <section className="setup-empty" aria-labelledby="setup-empty-heading">
            <span className="setup-empty__icon"><Database size={30} weight="regular" aria-hidden="true" /></span>
            <div>
              <h1 id="setup-empty-heading">No local configuration yet</h1>
              <p>Create the default setup in this Chrome profile, or import a JSON backup. Bookmark installation and Google Chat stay locked until then.</p>
            </div>
            <div className="setup-empty__actions">
              <Button tone="primary" icon={Plus} onClick={handleCreate}>Create local configuration</Button>
              <Button icon={FileArrowUp} onClick={() => importInputRef.current?.click()}>Import JSON</Button>
            </div>
          </section>
        ) : null}
        {message ? (
          <div className="message-row">
            <InlineNotice tone={message.tone}>{message.text}</InlineNotice>
            <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss message">
              <X size={20} weight="bold" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {configured && activeSection === "window" ? (
          <WindowPanel
            config={config}
            setConfig={setConfig}
            setActiveSection={setActiveSection}
            configured={configured}
            bookmarkletHref={bookmarkletHref}
            onOpenGoogleChat={handleOpenGoogleChat}
          />
        ) : null}
        {configured && activeSection === "people" ? (
          <PeoplePanel config={config} setConfig={setConfig} />
        ) : null}
        {configured && activeSection === "replies" ? (
          <RepliesPanel
            config={config}
            setConfig={setConfig}
            setMessage={setMessage}
            onValidateProvider={validateProvider}
          />
        ) : null}
        {configured && activeSection === "safety" ? (
          <SafetyPanel
            config={config}
            setConfig={setConfig}
            setMessage={setMessage}
          />
        ) : null}
      </main>
      <footer className="app-footer">
        <span>Chatbut · local-first proof of concept</span>
        <span>Configuration and optional logs stay in this Chrome profile.</span>
        <button type="button" className="app-footer__link" onClick={handleOpenGoogleChat} disabled={!configured}>
          Open Google Chat <ArrowSquareOut size={16} weight="bold" aria-hidden="true" />
        </button>
      </footer>
    </div>
  );
}
