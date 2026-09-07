"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Plus, Trash2, Wrench, X } from "lucide-react";
import {
  bindingPlaceholders, emptyTool, parameterSchema, runTool, toolProblems,
  type HttpMethod, type JsonSchemaType, type ToolDefinition, type ToolParameter, type ToolRun,
} from "@/lib/tools";

/**
 * The tool workbench: define a function the agent can call, point it at a real API, and run
 * it by hand before ever starting a call.
 *
 * The schema half (name / description / parameters) is what goes into `session.update`; the
 * binding half is executed client-side and returned as a `function_call_output`.
 * https://docs.boson.ai/models/higgs-realtime/guides/tool-calling
 */

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const TYPES: JsonSchemaType[] = ["string", "number", "integer", "boolean"];

function prettyJson(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Compact list used inside the agent settings panel to pick which tools an agent may call. */
/** The badge on a tool row: how it runs, in a word. */
function bindingTag(binding: ToolDefinition["binding"]) {
  if (binding.kind === "mock") return "Mock";
  if (binding.kind === "control") return "Session";
  return binding.method;
}

function bindingDetail(binding: ToolDefinition["binding"]) {
  if (binding.kind === "mock") return "Mock response";
  if (binding.kind === "control") return "Ends the call";
  return binding.url;
}

export function ToolSelector({ tools, selected, onToggle, onManage, disabled, hideSelected = false, hideManage = false }: {
  tools: ToolDefinition[]; selected: string[]; onToggle: (id: string) => void; onManage: () => void;
  disabled?: boolean;
  /** Drop tools already chosen. For a picker sitting under the list of what is chosen. */
  hideSelected?: boolean;
  /** The caller already offers a way into the library. */
  hideManage?: boolean;
}) {
  const shown = hideSelected ? tools.filter(tool => !selected.includes(tool.id)) : tools;
  return <>
    <div className="tool-picks">
      {shown.map(tool => {
        const problems = toolProblems(tool);
        return <label key={tool.id} className={`tool-pick ${selected.includes(tool.id) ? "on" : ""} ${problems.length ? "invalid" : ""}`}>
          <input
            type="checkbox"
            checked={selected.includes(tool.id)}
            disabled={disabled || problems.length > 0}
            onChange={() => onToggle(tool.id)}
          />
          <span>
            <b>{tool.name || "Untitled tool"}</b>
            <small>{problems[0] ?? tool.description}</small>
          </span>
          <i className={`tool-tag ${tool.binding.kind}`}>{bindingTag(tool.binding)}</i>
        </label>;
      })}
      {!shown.length && <p className="help">{tools.length ? "Every tool is already on this agent." : "No tools yet."}</p>}
    </div>
    {!hideManage && <button className="browse" onClick={onManage}><Wrench aria-hidden="true" />Manage tools</button>}
  </>;
}

export function ToolsModal({ tools, onClose, onSave, onDelete, newId }: {
  tools: ToolDefinition[];
  onClose: () => void;
  onSave: (tool: ToolDefinition) => void;
  onDelete: (id: string) => void;
  newId: (prefix: string) => string;
}) {
  const [selectedId, setSelectedId] = useState(tools[0]?.id ?? "");
  const selected = tools.find(tool => tool.id === selectedId) ?? tools[0];

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const create = () => {
    const tool = emptyTool(newId("tool"));
    onSave(tool);
    setSelectedId(tool.id);
  };

  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="picker-modal tools-modal" role="dialog" aria-modal="true" aria-labelledby="tools-title">
      <div className="modal-head">
        <h2 id="tools-title">Tools</h2>
        <button aria-label="Close" onClick={onClose}><X /></button>
      </div>
      <div className="tools-layout">
        <div className="tools-list">
          {tools.map(tool => <button
            key={tool.id}
            className={tool.id === selected?.id ? "active" : ""}
            onClick={() => setSelectedId(tool.id)}
          >
            <b>{tool.name || "Untitled tool"}</b>
            <small>{tool.source ?? bindingDetail(tool.binding)}</small>
          </button>)}
          <button className="tools-new" onClick={create}><Plus aria-hidden="true" />New tool</button>
        </div>
        {selected
          ? <ToolEditor
              key={selected.id}
              tool={selected}
              onChange={onSave}
              onDelete={() => { onDelete(selected.id); setSelectedId(tools.find(tool => tool.id !== selected.id)?.id ?? ""); }}
            />
          : <div className="no-results">Create a tool to get started.</div>}
      </div>
    </section>
  </div>;
}

function ToolEditor({ tool, onChange, onDelete }: {
  tool: ToolDefinition; onChange: (tool: ToolDefinition) => void; onDelete: () => void;
}) {
  const [tab, setTab] = useState<"define" | "test">("define");
  const problems = toolProblems(tool);
  const patch = (changes: Partial<ToolDefinition>) => onChange({ ...tool, ...changes });

  return <div className="tool-editor">
    <div className="tool-editor-head">
      <div className="mode-switch tool-tabs">
        <button className={tab === "define" ? "active" : ""} onClick={() => setTab("define")}>Define</button>
        <button className={tab === "test" ? "active" : ""} onClick={() => setTab("test")}>Test</button>
      </div>
      <button className="tool-delete" onClick={onDelete} title="Delete this tool"><Trash2 aria-hidden="true" />Delete</button>
    </div>

    {tab === "define"
      ? <div className="tool-form">
          <label className="field">
            <span>Function name <em>what the model calls</em></span>
            <input
              value={tool.name}
              onChange={event => patch({ name: event.currentTarget.value.replace(/[^a-zA-Z0-9_-]/g, "_") })}
              placeholder="get_weather"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Description <em>how the model decides to call it</em></span>
            <textarea
              className="short"
              value={tool.description}
              onChange={event => patch({ description: event.currentTarget.value })}
              placeholder="Get the current weather conditions and temperature for a city."
            />
          </label>

          <ParameterEditor parameters={tool.parameters} onChange={parameters => patch({ parameters })} />
          <BindingEditor tool={tool} onChange={patch} />

          <details className="tool-schema">
            <summary>Schema sent in session.update</summary>
            <pre>{JSON.stringify({ type: "function", name: tool.name, description: tool.description, parameters: parameterSchema(tool.parameters) }, null, 2)}</pre>
          </details>

          {problems.length > 0 && <ul className="tool-problems">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>}
        </div>
      : <ToolTester tool={tool} problems={problems} />}
  </div>;
}

function ParameterEditor({ parameters, onChange }: { parameters: ToolParameter[]; onChange: (next: ToolParameter[]) => void }) {
  const patch = (index: number, changes: Partial<ToolParameter>) =>
    onChange(parameters.map((parameter, at) => at === index ? { ...parameter, ...changes } : parameter));

  return <div className="tool-block">
    <h3>Parameters</h3>
    <p className="help">Sent to the model as a JSON schema. Reference one in the request below as <code>{"{{name}}"}</code>.</p>
    {parameters.map((parameter, index) => <div className="tool-param" key={index}>
      <input
        value={parameter.name}
        onChange={event => patch(index, { name: event.currentTarget.value.replace(/[^a-zA-Z0-9_]/g, "_") })}
        placeholder="name"
        spellCheck={false}
      />
      <select value={parameter.type} onChange={event => patch(index, { type: event.currentTarget.value as JsonSchemaType })}>
        {TYPES.map(type => <option key={type} value={type}>{type}</option>)}
      </select>
      <input
        className="grow"
        value={parameter.description}
        onChange={event => patch(index, { description: event.currentTarget.value })}
        placeholder="What this argument means"
      />
      <label title="Required argument">
        <input type="checkbox" checked={parameter.required} onChange={event => patch(index, { required: event.currentTarget.checked })} />
        req
      </label>
      <button aria-label="Remove parameter" onClick={() => onChange(parameters.filter((_, at) => at !== index))}><X /></button>
    </div>)}
    <button
      className="tool-add"
      onClick={() => onChange([...parameters, { name: "", type: "string", description: "", required: true }])}
    ><Plus aria-hidden="true" />Add parameter</button>
  </div>;
}

function BindingEditor({ tool, onChange }: { tool: ToolDefinition; onChange: (changes: Partial<ToolDefinition>) => void }) {
  const { binding } = tool;
  const setHttp = (changes: Partial<Extract<ToolDefinition["binding"], { kind: "http" }>>) => {
    if (binding.kind !== "http") return;
    onChange({ binding: { ...binding, ...changes } });
  };

  return <div className="tool-block">
    <h3>Request</h3>
    <div className="mode-switch">
      <button
        className={binding.kind === "http" ? "active" : ""}
        onClick={() => binding.kind === "mock" && onChange({ binding: emptyTool(tool.id).binding })}
      >Real API</button>
      <button
        className={binding.kind === "mock" ? "active" : ""}
        onClick={() => binding.kind === "http" && onChange({ binding: { kind: "mock", response: '{"ok":true}' } })}
      >Mock response</button>
    </div>

    {binding.kind === "mock"
      ? <label className="field">
          <span>Returned to the model <em>{"{{arg}}"} placeholders are filled in</em></span>
          <textarea
            className="mono"
            value={binding.response}
            onChange={event => onChange({ binding: { kind: "mock", response: event.currentTarget.value } })}
          />
        </label>
      : binding.kind === "control"
      ? <p className="help">
          This tool acts on the call itself rather than calling an API, so it has nothing to configure.
        </p>
      : <>
          <div className="tool-url">
            <select value={binding.method} onChange={event => setHttp({ method: event.currentTarget.value as HttpMethod })}>
              {METHODS.map(method => <option key={method} value={method}>{method}</option>)}
            </select>
            <input
              value={binding.url}
              onChange={event => setHttp({ url: event.currentTarget.value })}
              placeholder="https://api.example.com/search?q={{query}}"
              spellCheck={false}
            />
          </div>

          <div className="tool-auth">
            <select value={binding.auth.type} onChange={event => setHttp({ auth: { ...binding.auth, type: event.currentTarget.value as "none" | "bearer" | "header" } })}>
              <option value="none">No auth</option>
              <option value="bearer">Bearer token</option>
              <option value="header">API key header</option>
            </select>
            {binding.auth.type === "header" && <input
              value={binding.auth.headerName}
              onChange={event => setHttp({ auth: { ...binding.auth, headerName: event.currentTarget.value } })}
              placeholder="X-Api-Key"
              spellCheck={false}
            />}
            {binding.auth.type !== "none" && <input
              type="password"
              value={binding.auth.token}
              onChange={event => setHttp({ auth: { ...binding.auth, token: event.currentTarget.value } })}
              placeholder="Token"
            />}
          </div>

          <div className="tool-headers">
            {binding.headers.map((header, index) => <div className="tool-param" key={index}>
              <input
                value={header.key}
                onChange={event => setHttp({ headers: binding.headers.map((entry, at) => at === index ? { ...entry, key: event.currentTarget.value } : entry) })}
                placeholder="Header"
                spellCheck={false}
              />
              <input
                className="grow"
                value={header.value}
                onChange={event => setHttp({ headers: binding.headers.map((entry, at) => at === index ? { ...entry, value: event.currentTarget.value } : entry) })}
                placeholder="Value"
                spellCheck={false}
              />
              <button aria-label="Remove header" onClick={() => setHttp({ headers: binding.headers.filter((_, at) => at !== index) })}><X /></button>
            </div>)}
            <button className="tool-add" onClick={() => setHttp({ headers: [...binding.headers, { key: "", value: "" }] })}>
              <Plus aria-hidden="true" />Add header
            </button>
          </div>

          {binding.method !== "GET" && binding.method !== "DELETE" && <label className="field">
            <span>JSON body</span>
            <textarea
              className="mono"
              value={binding.body}
              onChange={event => setHttp({ body: event.currentTarget.value })}
              placeholder={'{"query": "{{query}}"}'}
            />
          </label>}

          <p className="help">
            Calls are proxied through this app&apos;s server so third-party APIs are reachable from the browser.
          </p>
        </>}
  </div>;
}

function ToolTester({ tool, problems }: { tool: ToolDefinition; problems: string[] }) {
  const placeholders = useMemo(() => bindingPlaceholders(tool.binding), [tool.binding]);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [run, setRun] = useState<ToolRun | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const fields = tool.parameters.length
    ? tool.parameters
    : placeholders.map(name => ({ name, type: "string" as const, description: "", required: true }));

  const coerce = (parameter: { name: string; type: string }, raw: string): unknown => {
    if (parameter.type === "boolean") return raw === "true";
    if (parameter.type === "number" || parameter.type === "integer") {
      const value = Number(raw);
      return Number.isFinite(value) ? value : raw;
    }
    return raw;
  };

  const execute = async () => {
    setBusy(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const payload = Object.fromEntries(fields.map(field => [field.name, coerce(field, args[field.name] ?? "")]));
    try {
      setRun(await runTool(tool, payload, controller.signal));
    } finally {
      setBusy(false);
    }
  };

  return <div className="tool-form">
    <div className="tool-block">
      <h3>Arguments</h3>
      <p className="help">Stand in for what the model would send, then call the API for real.</p>
      {fields.map(field => <label className="field" key={field.name || Math.random()}>
        <span>{field.name || "unnamed"} <em>{field.type}{field.required ? "" : " · optional"}</em></span>
        {field.type === "boolean"
          ? <select value={args[field.name] ?? "true"} onChange={event => setArgs({ ...args, [field.name]: event.currentTarget.value })}>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          : <input
              value={args[field.name] ?? ""}
              onChange={event => setArgs({ ...args, [field.name]: event.currentTarget.value })}
              placeholder={field.description || `Value for ${field.name}`}
            />}
      </label>)}
      {!fields.length && <p className="help">This tool takes no arguments.</p>}
      <button className="tool-run" disabled={busy || problems.length > 0} onClick={() => void execute()}>
        <Play aria-hidden="true" />{busy ? "Calling…" : "Run tool"}
      </button>
      {problems.length > 0 && <ul className="tool-problems">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>}
    </div>

    {run && <div className="tool-block">
      <h3>
        Response
        <span className={`tool-status ${run.ok ? "ok" : "bad"}`}>
          {run.status ? `HTTP ${run.status}` : run.ok ? "OK" : "Failed"} · {run.durationMs} ms
        </span>
      </h3>
      {run.request && <p className="help mono">{run.request.method} {run.request.url}</p>}
      {run.error && <p className="clone-hint blocking">{run.error}</p>}
      <pre className="tool-output">{prettyJson(run.output)}</pre>
      <p className="help">This is verbatim what the agent receives as the tool result.</p>
    </div>}
  </div>;
}
