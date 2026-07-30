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
  Eye,
  EyeSlash,
  FileText,
  FloppyDisk,
  FolderOpen,
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
  formatClock,
  formatDayRange,
  formatSchedule,
  isScheduleActive,
  nextWindowLabel,
  normalizeConfig,
  validateConfig,
} from "./config.js";
import {
  chooseDebugFolder,
  createConfigFile,
  forgetRememberedConfigHandle,
  getRememberedConfigHandle,
  openConfigFile,
  readConfigHandle,
  requestConfigHandlePermission,
  writeConfigFile,
} from "./file-store.js";
import { validateDeepSeekKey } from "./deepseek.js";

const NAV_ITEMS = [
  { id: "window", label: "Window", Icon: Clock },
  { id: "people", label: "People", Icon: UsersThree },
  { id: "replies", label: "Replies", Icon: ChatsCircle },
  { id: "safety", label: "Safety", Icon: ShieldCheck },
];

function makeDefaultConfig() {
  return normalizeConfig(DEFAULT_CONFIG);
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

function BookmarkletLink({ href }) {
  const anchorRef = useRef(null);
  useEffect(() => {
    anchorRef.current?.setAttribute("href", href);
  }, [href]);
  return (
    <a
      ref={anchorRef}
      className="button button--primary install-strip__button"
      href="#install-chatbut"
      onClick={(event) => event.preventDefault()}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/uri-list", href);
        event.dataTransfer.setData("text/plain", href);
      }}
      draggable="true"
      title="Drag this button to the Chrome bookmarks bar"
    >
      <BookmarkSimple size={20} weight="bold" aria-hidden="true" />
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

function AppHeader({ fileName, dirty, onOpen, onCreate, onSave, saving }) {
  return (
    <header className="masthead">
      <div className="brand" aria-label="Chatbut">
        <img src="./assets/chatbut-mark.png" alt="" width="48" height="48" />
        <span>Chatbut</span>
      </div>
      <div className="masthead__file">
        <FileText size={20} weight="regular" aria-hidden="true" />
        <span className={`status-dot${fileName ? "" : " status-dot--idle"}`} aria-hidden="true" />
        <span className="masthead__filename">{fileName || "No configuration selected"}</span>
        <span className="masthead__local">· Local</span>
        {dirty ? <span className="dirty-badge">Unsaved</span> : null}
      </div>
      <div className="masthead__actions">
        <Button icon={FolderOpen} onClick={onOpen}>Open</Button>
        <Button icon={Plus} onClick={onCreate}>New</Button>
        <Button
          icon={FloppyDisk}
          tone="support"
          onClick={onSave}
          disabled={!fileName || saving}
          loading={saving}
        >
          Save
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
  const labels = useMemo(() => {
    const [startHour, startMinute] = schedule.start.split(":").map(Number);
    const [endHour, endMinute] = schedule.end.split(":").map(Number);
    const start = startHour * 60 + startMinute;
    let end = endHour * 60 + endMinute;
    if (end <= start) end += 24 * 60;
    const duration = end - start;
    return Array.from({ length: 9 }, (_, index) => {
      const minutes = start + Math.round((duration * index) / 8);
      const wrapped = minutes % (24 * 60);
      return {
        position: `${(index / 8) * 100}%`,
        label: formatClock(
          `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`,
        ),
      };
    });
  }, [schedule.end, schedule.start]);

  return (
    <div className="timeline" aria-label={`Scheduled from ${formatClock(schedule.start)} to ${formatClock(schedule.end)}`}>
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

function OverlayPreview({
  active,
  canEnable,
  onEnable,
  onStop,
  nextWindow,
  scheduleLabel,
}) {
  return (
    <aside className="overlay-frame" aria-label="Google Chat overlay preview">
      <span className="overlay-frame__label">Google Chat overlay preview</span>
      <div className={`overlay-panel${active ? " is-enabled" : ""}`}>
        <img src="./assets/chatbut-mark.png" alt="" width="72" height="72" />
        <h2>{active ? "Chatbut is active" : "Outside your window"}</h2>
        <p>
          <CalendarBlank size={18} weight="bold" aria-hidden="true" />
          {active ? scheduleLabel : nextWindow}
        </p>
        <div className="overlay-panel__actions">
          <Button
            tone="support"
            icon={Play}
            onClick={onEnable}
            disabled={!canEnable || active}
          >
            Enable
          </Button>
          <Button tone="danger" icon={Stop} onClick={onStop} disabled={!active}>
            Stop
          </Button>
        </div>
        <span className="overlay-panel__reassurance">
          {active ? "Monitoring only new eligible messages." : "Auto-ack is disabled right now. You’re in control."}
        </span>
      </div>
    </aside>
  );
}

function WindowPanel({
  config,
  setConfig,
  setActiveSection,
  canEnable,
  enabled,
  setEnabled,
  fileName,
  keyStatus,
  setMessage,
  bookmarkletHref,
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

  function updateDelay(key, value) {
    setConfig((current) => ({
      ...current,
      delays: { ...current.delays, [key]: Number(value) },
    }));
  }

  function handleEnable() {
    if (!fileName) {
      setMessage({ tone: "warning", text: "Choose or create a configuration file before enabling." });
      return;
    }
    if (config.ai.enabled && keyStatus !== "valid") {
      setActiveSection("replies");
      setMessage({ tone: "warning", text: "Validate the DeepSeek key before enabling." });
      return;
    }
    if (!activeNow) {
      setMessage({ tone: "warning", text: "You are outside the configured window. Review the schedule before enabling." });
      return;
    }
    setEnabled(true);
    setMessage({ tone: "info", text: "Preview enabled. The bookmarklet will use this same safety check in Google Chat." });
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
          <div>
            <strong id="install-heading">Install once, start deliberately</strong>
            <span>Drag this button to Chrome’s bookmarks bar. Click it only while Google Chat is open.</span>
          </div>
          {bookmarkletHref ? (
            <BookmarkletLink href={bookmarkletHref} />
          ) : (
            <span className="install-strip__loading">
              <SpinnerGap className="spin" size={20} weight="bold" aria-hidden="true" />
              Preparing bookmarklet
            </span>
          )}
        </section>

        <div className="window-clock" aria-hidden="true">
          <strong>{formatClock(config.schedule.start)}</strong>
          <span>{formatDayRange(config.schedule.days)}</span>
          <strong>{formatClock(config.schedule.end)}</strong>
        </div>

        <Timeline schedule={config.schedule} />

        <div className="settings-list">
          <FieldRow
            Icon={CalendarBlank}
            label="Schedule"
            value={scheduleLabel}
            onClick={() => setEditingSchedule((current) => !current)}
          />
          {editingSchedule ? (
            <div className="window-editor">
              <DaySelector days={config.schedule.days} onChange={(days) => updateSchedule("days", days)} />
              <div className="time-fields">
                <label>
                  <span>Start time</span>
                  <input
                    type="time"
                    value={config.schedule.start}
                    onChange={(event) => updateSchedule("start", event.target.value)}
                  />
                </label>
                <label>
                  <span>End time</span>
                  <input
                    type="time"
                    value={config.schedule.end}
                    onChange={(event) => updateSchedule("end", event.target.value)}
                  />
                </label>
              </div>
            </div>
          ) : null}
          <FieldRow
            Icon={User}
            label="Direct messages"
            value={`Everyone except ${config.targeting.directExclusions.length} ${config.targeting.directExclusions.length === 1 ? "person" : "people"}`}
            onClick={() => setActiveSection("people")}
          />
          <FieldRow
            Icon={Hash}
            label="Group mentions"
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
        active={enabled}
        canEnable={canEnable}
        onEnable={handleEnable}
        onStop={() => {
          setEnabled(false);
          setMessage({ tone: "info", text: "Preview stopped immediately." });
        }}
        nextWindow={nextWindowLabel(config)}
        scheduleLabel={scheduleLabel}
      />
    </section>
  );
}

function SearchTargets({ title, description, items, onRemove, emptyCopy }) {
  const [query, setQuery] = useState("");
  const filtered = items.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));
  return (
    <section className="editor-section">
      <div className="editor-section__heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="count-badge">{items.length}</span>
      </div>
      <label className="search-field">
        <span>Filter saved chats</span>
        <span className="input-shell">
          <MagnifyingGlass size={20} weight="regular" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by chat name"
          />
        </span>
      </label>
      {filtered.length ? (
        <ul className="target-list">
          {filtered.map((item) => (
            <li key={item.id}>
              <span>{item.label}</span>
              <button type="button" onClick={() => onRemove(item.id)} aria-label={`Remove ${item.label}`}>
                <X size={20} weight="bold" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-state">
          <List size={32} weight="regular" aria-hidden="true" />
          <strong>{query ? "No saved chats match" : emptyCopy}</strong>
          <span>Add current chats from the injected Google Chat overlay.</span>
        </div>
      )}
    </section>
  );
}

function PeoplePanel({ config, setConfig }) {
  function removeTarget(key, id) {
    setConfig((current) => ({
      ...current,
      targeting: {
        ...current.targeting,
        [key]: current.targeting[key].filter((item) => item.id !== id),
      },
    }));
  }
  return (
    <section className="workspace workspace--editor" aria-labelledby="people-heading">
      <div className="section-heading section-heading--wide">
        <div>
          <h1 id="people-heading">Choose who receives replies</h1>
          <p>Direct messages use an exclusion list. Group spaces require an explicit selection and an @mention or direct reply.</p>
        </div>
      </div>
      <div className="policy-band">
        <div>
          <User size={24} weight="regular" aria-hidden="true" />
          <span><strong>Direct messages</strong>Everyone except exclusions</span>
        </div>
        <div>
          <Hash size={24} weight="regular" aria-hidden="true" />
          <span><strong>Group spaces</strong>Selected spaces only</span>
        </div>
      </div>
      <div className="editor-grid">
        <SearchTargets
          title="Direct-message exclusions"
          description="Chatbut skips these people."
          items={config.targeting.directExclusions}
          onRemove={(id) => removeTarget("directExclusions", id)}
          emptyCopy="No one is excluded"
        />
        <SearchTargets
          title="Selected group spaces"
          description="Only @mentions and direct replies in these spaces qualify."
          items={config.targeting.selectedGroups}
          onRemove={(id) => removeTarget("selectedGroups", id)}
          emptyCopy="No group spaces selected"
        />
      </div>
      <InlineNotice>
        Recent chats are indexed only after you run Chatbut on Google Chat. Search there, then add a conversation to this configuration file.
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
  keyStatus,
  setKeyStatus,
  setMessage,
}) {
  const [showKey, setShowKey] = useState(false);

  function updateAi(key, value) {
    setConfig((current) => ({ ...current, ai: { ...current.ai, [key]: value } }));
    if (key === "apiKey") setKeyStatus("idle");
  }

  async function validateKey() {
    setKeyStatus("validating");
    setMessage(null);
    try {
      await validateDeepSeekKey(config.ai.apiKey);
      setKeyStatus("valid");
      setMessage({ tone: "info", text: "DeepSeek key validated. Chatbut can adapt saved acknowledgements." });
    } catch (error) {
      setKeyStatus("invalid");
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "DeepSeek validation failed." });
    }
  }

  return (
    <section className="workspace workspace--editor" aria-labelledby="replies-heading">
      <div className="section-heading section-heading--wide">
        <div>
          <h1 id="replies-heading">Keep replies human and bounded</h1>
          <p>Chatbut randomly selects a saved response, then DeepSeek may adapt its wording without changing its acknowledge-and-defer intent.</p>
        </div>
      </div>

      <section className="api-panel">
        <div className="api-panel__heading">
          <span className="api-panel__icon"><Key size={24} weight="regular" aria-hidden="true" /></span>
          <div>
            <h2>DeepSeek connection</h2>
            <p>Validated once per enable. The key stays in your plaintext local configuration file.</p>
          </div>
          <span className={`validation-badge validation-badge--${config.ai.enabled ? keyStatus : "disabled"}`}>
            {!config.ai.enabled ? "Optional · off" : keyStatus === "valid" ? "Validated" : keyStatus === "validating" ? "Checking" : keyStatus === "invalid" ? "Invalid" : "Not checked"}
          </span>
        </div>
        <Toggle
          checked={config.ai.enabled}
          onChange={(enabled) => {
            updateAi("enabled", enabled);
            setKeyStatus(enabled ? "idle" : "disabled");
          }}
          label={config.ai.enabled ? "AI adaptation enabled" : "Use saved responses only"}
          description="Optional. Without DeepSeek, Chatbut sends the randomly selected saved response unchanged."
        />
        {config.ai.enabled ? (
          <>
        <div className="api-panel__fields">
          <label className="secret-field">
            <span>DeepSeek API key</span>
            <span className="input-shell">
              <LockKey size={20} weight="regular" aria-hidden="true" />
              <input
                type={showKey ? "text" : "password"}
                value={config.ai.apiKey}
                onChange={(event) => updateAi("apiKey", event.target.value)}
                placeholder="sk-…"
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
            onClick={validateKey}
            loading={keyStatus === "validating"}
            success={keyStatus === "valid"}
            disabled={!config.ai.apiKey || keyStatus === "validating"}
          >
            {keyStatus === "valid" ? "Key valid" : "Validate key"}
          </Button>
        </div>
        <div className="api-panel__options">
          <label>
            <span>Recent messages sent for context</span>
            <input
              type="number"
              min="3"
              max="10"
              value={config.ai.recentMessageCount}
              onChange={(event) => updateAi("recentMessageCount", Number(event.target.value))}
            />
          </label>
          <label>
            <span>Reply language</span>
            <select
              value={config.ai.language}
              onChange={(event) => updateAi("language", event.target.value)}
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
          </>
        ) : (
          <div className="bounded-copy bounded-copy--standalone">
            <CheckCircle size={20} weight="bold" aria-hidden="true" />
            <span>No chat content leaves Google Chat. Vault selection, delays, and safeguards still apply.</span>
          </div>
        )}
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
  debugFolder,
  setDebugFolder,
  setMessage,
}) {
  async function selectFolder() {
    try {
      const handle = await chooseDebugFolder();
      setDebugFolder(handle);
      setMessage({ tone: "info", text: `Debug logs will be written to the selected folder “${handle.name}”.` });
    } catch (error) {
      if (error?.name !== "AbortError") {
        setMessage({ tone: "error", text: error instanceof Error ? error.message : "Folder access failed." });
      }
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
                <FolderOpen size={22} weight="regular" aria-hidden="true" />
                <span>
                  <strong>{debugFolder?.name || "No folder selected"}</strong>
                  <small>Select the folder containing your configuration file.</small>
                </span>
              </div>
              <Button icon={FolderOpen} onClick={selectFolder}>Choose folder</Button>
            </div>
          ) : null}
        </section>
      </div>

      <InlineNotice tone="warning">
        This proof of concept stores the DeepSeek key in plaintext. Anyone or any process with access to the configuration file can read it. Sending work messages to DeepSeek must also be allowed by your organization.
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
          <span>Selected local file only</span>
        </div>
      </section>
    </section>
  );
}

export function App() {
  const [activeSection, setActiveSection] = useState("window");
  const [config, setConfigState] = useState(makeDefaultConfig);
  const [fileRecord, setFileRecord] = useState(null);
  const [debugFolder, setDebugFolder] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyStatus, setKeyStatus] = useState("idle");
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState(null);
  const [bookmarkletHref, setBookmarkletHref] = useState("");
  const [rememberedHandle, setRememberedHandle] = useState(null);

  const validation = useMemo(() => validateConfig(config), [config]);
  const canEnable = Boolean(
    fileRecord?.handle
    && validation.valid
    && (!config.ai.enabled || keyStatus === "valid")
    && isScheduleActive(config),
  );

  function setConfig(updater) {
    setConfigState((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      return normalizeConfig(next);
    });
    setDirty(true);
    setEnabled(false);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("./chatbut-bookmarklet.txt")
      .then((response) => {
        if (!response.ok) throw new Error("Bookmarklet artifact is unavailable.");
        return response.text();
      })
      .then((value) => {
        if (!cancelled) setBookmarkletHref(value.trim());
      })
      .catch(() => {
        if (!cancelled) setMessage({ tone: "error", text: "The bookmarklet could not be prepared. Reload this page or check the deployment." });
      });
    getRememberedConfigHandle()
      .then((handle) => {
        if (!cancelled && handle) setRememberedHandle(handle);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setInterval(() => {
      if (!isScheduleActive(config)) {
        setEnabled(false);
        setMessage({ tone: "warning", text: "Preview stopped because the configured window closed." });
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [config, enabled]);

  async function useRememberedFile() {
    try {
      const permitted = await requestConfigHandlePermission(rememberedHandle);
      if (!permitted) {
        setMessage({ tone: "warning", text: "Chrome did not grant access to the remembered file." });
        return;
      }
      const record = await readConfigHandle(rememberedHandle);
      setFileRecord(record);
      setConfigState(record.config);
      setDirty(false);
      setKeyStatus(record.config.ai.enabled ? "idle" : "disabled");
      setRememberedHandle(null);
      setMessage({ tone: "info", text: `Loaded remembered file ${record.name}.` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The remembered file is unavailable." });
    }
  }

  async function forgetRememberedFile() {
    await forgetRememberedConfigHandle();
    setRememberedHandle(null);
    setMessage({ tone: "info", text: "Forgot the previous file. Choose Open or New when you are ready." });
  }

  async function handleOpen() {
    setMessage(null);
    try {
      const record = await openConfigFile();
      setFileRecord(record);
      setConfigState(record.config);
      setDirty(false);
      setEnabled(false);
      setKeyStatus("idle");
      setDebugFolder(null);
      setMessage({ tone: "info", text: `Loaded ${record.name}. Validate the DeepSeek key before enabling.` });
    } catch (error) {
      if (error?.name !== "AbortError") {
        setMessage({ tone: "error", text: error instanceof Error ? error.message : "Unable to open the configuration." });
      }
    }
  }

  async function handleCreate() {
    setMessage(null);
    try {
      const nextConfig = makeDefaultConfig();
      const record = await createConfigFile(nextConfig);
      setFileRecord(record);
      setConfigState(record.config);
      setDirty(false);
      setEnabled(false);
      setKeyStatus("idle");
      setDebugFolder(null);
      setMessage({ tone: "info", text: `Created ${record.name}. Add and validate your DeepSeek key next.` });
      setActiveSection("replies");
    } catch (error) {
      if (error?.name !== "AbortError") {
        setMessage({ tone: "error", text: error instanceof Error ? error.message : "Unable to create the configuration." });
      }
    }
  }

  async function handleSave() {
    if (!fileRecord?.handle) return;
    setSaving(true);
    setMessage(null);
    try {
      await writeConfigFile(fileRecord.handle, config);
      setDirty(false);
      setMessage({ tone: "info", text: `Saved ${fileRecord.name} locally.` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Unable to save the configuration." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app-shell">
      <AppHeader
        fileName={fileRecord?.name}
        dirty={dirty}
        onOpen={handleOpen}
        onCreate={handleCreate}
        onSave={handleSave}
        saving={saving}
      />
      <Sidebar
        active={activeSection}
        onChange={setActiveSection}
        ready={validation.valid && Boolean(fileRecord)}
      />
      <main className="app-main">
        {rememberedHandle && !fileRecord ? (
          <section className="remembered-file" aria-label="Remembered configuration">
            <FileText size={22} weight="regular" aria-hidden="true" />
            <div>
              <strong>Use your previous local configuration?</strong>
              <span>Chrome remembers the file handle, but Chatbut will not open it without your permission.</span>
            </div>
            <Button tone="support" onClick={useRememberedFile}>Use file</Button>
            <Button onClick={forgetRememberedFile}>Forget</Button>
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

        {activeSection === "window" ? (
          <WindowPanel
            config={config}
            setConfig={setConfig}
            setActiveSection={setActiveSection}
            canEnable={canEnable}
            enabled={enabled}
            setEnabled={setEnabled}
            fileName={fileRecord?.name}
            keyStatus={keyStatus}
            setMessage={setMessage}
            bookmarkletHref={bookmarkletHref}
          />
        ) : null}
        {activeSection === "people" ? (
          <PeoplePanel config={config} setConfig={setConfig} />
        ) : null}
        {activeSection === "replies" ? (
          <RepliesPanel
            config={config}
            setConfig={setConfig}
            keyStatus={keyStatus}
            setKeyStatus={setKeyStatus}
            setMessage={setMessage}
          />
        ) : null}
        {activeSection === "safety" ? (
          <SafetyPanel
            config={config}
            setConfig={setConfig}
            debugFolder={debugFolder}
            setDebugFolder={setDebugFolder}
            setMessage={setMessage}
          />
        ) : null}
      </main>
      <footer className="app-footer">
        <span>Chatbut · local-first proof of concept</span>
        <span>Nothing runs until you click the bookmarklet.</span>
        <a href="https://chat.google.com/app/home" target="_blank" rel="noreferrer">
          Open Google Chat <ArrowSquareOut size={16} weight="bold" aria-hidden="true" />
        </a>
      </footer>
    </div>
  );
}
