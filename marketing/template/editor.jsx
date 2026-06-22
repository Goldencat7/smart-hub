/* global React, ReactDOM, VendidoA, VendidoB, htmlToImage */
const { useState, useEffect, useRef, useCallback } = React;

const STORAGE_KEY = "vendido_editor_v5";

function getBase(){
  const d = window.VENDIDO_DEFAULTS || {};
  return {
    nome: ((d.name1||"LEANDRO") + " " + (d.name2||"FREITAS")).trim(),
    cargo: d.cargo || "Corretor",
    creci: d.creci || "CRECI 40431-J",
    phone: d.phone || "(11) 98506-0725",
    site: d.site || "www.remax.com.br/smart",
    locBairro: d.locBairro || "PENHA DE FRANÇA",
    locZona: d.locZona || "ZONA LESTE",
    imovel: d.imovel || "assets/imovel.jpg",
    agent: d.agent || "assets/leandro-crop.png",
    imovelPosX: d.imovelPosX != null ? d.imovelPosX : 50,
    imovelZoom: d.imovelZoom || 1,
    agentOffsetY: d.agentOffsetY || 0,
    agentZoom: d.agentZoom || 1,
    nameFontSize: d.nameFontSize || 82
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) return Object.assign({}, getBase(), JSON.parse(raw));
  }catch(e){}
  return getBase();
}

function toData(s){
  const parts = (s.nome || "").trim().split(/\s+/);
  const name1 = parts.shift() || "";
  const name2 = parts.join(" ");
  return Object.assign({}, s, { name1, name2 });
}

/* live-scaled preview of a fixed 1080x1440 component */
function Preview({ children }){
  const frameRef = useRef(null);
  const scalerRef = useRef(null);
  useEffect(() => {
    const frame = frameRef.current, scaler = scalerRef.current;
    if(!frame || !scaler) return;
    const fit = () => { scaler.style.transform = "scale(" + (frame.clientWidth / 1080) + ")"; };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(frame);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="frame" ref={frameRef}>
      <div className="scaler" ref={scalerRef}>{children}</div>
    </div>
  );
}

function Upload({ label, hint, value, onPick }){
  const inputRef = useRef(null);
  const isCustom = value && value.startsWith("data:");
  return (
    <div className="field">
      <div className="upload" onClick={() => inputRef.current && inputRef.current.click()}>
        <div className="thumb" style={{ backgroundImage: "url(" + value + ")" }}></div>
        <div className="utext">
          <b>{label}</b>
          <span>{isCustom ? "Imagem carregada · clique para trocar" : "Clique para enviar uma imagem"}</span>
        </div>
        <input ref={inputRef} type="file" accept="image/*" onChange={(e) => {
          const f = e.target.files && e.target.files[0];
          if(!f) return;
          const r = new FileReader();
          r.onload = () => onPick(r.result);
          r.readAsDataURL(f);
        }}/>
      </div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }){
  return (
    <div className="field">
      <label>{label}</label>
      <input type="text" value={value} placeholder={placeholder || ""} onChange={(e) => onChange(e.target.value)}/>
    </div>
  );
}

function App(){
  const [s, setS] = useState(loadState);
  const [version, setVersion] = useState(window.LOCKED_VERSION || "a");
  const locked = !!window.LOCKED_VERSION;
  const [busy, setBusy] = useState(false);
  const exportRef = useRef(null);

  // persist text fields only — images are session-only (not saved to localStorage)
  useEffect(() => {
    try{
      const toSave = Object.assign({}, s);
      delete toSave.imovel;
      delete toSave.agent;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    }catch(e){}
  }, [s]);

  const set = (k) => (v) => setS(prev => Object.assign({}, prev, { [k]: v }));
  const data = toData(s);
  const Comp = version === "b" ? VendidoB : VendidoA;
  const vLabel = version === "b" ? "V2 - Editorial Premium" : "V1 - Faixa Diagonal";

  const download = useCallback(async () => {
    setBusy(true);
    try{
      const node = exportRef.current.querySelector(".vendido");
      await document.fonts.ready;
      const imgs = Array.from(node.querySelectorAll("img"));
      await Promise.all(imgs.map(im => im.complete ? Promise.resolve() : new Promise(r => { im.onload = im.onerror = r; })));
      await new Promise(r => setTimeout(r, 150));
      const url = await htmlToImage.toPng(node, { width: 1080, height: 1440, pixelRatio: 2, cacheBust: true });
      const a = document.createElement("a");
      const safeName = (s.nome || "corretor").trim().replace(/\s+/g, "-");
      a.href = url; a.download = "VENDIDO-" + vLabel.split(" ")[0] + "-" + safeName + ".png";
      document.body.appendChild(a); a.click(); a.remove();
    }catch(e){ alert("Erro ao gerar PNG: " + e.message); }
    finally{ setBusy(false); }
  }, [s, vLabel]);

  const reset = () => { if(confirm("Restaurar todos os dados originais?")) setS(getBase()); };

  return (
    <div className="app">
      <div className="panel">
        <h1>{locked ? (version === "a" ? "Template V1 · Faixa Diagonal" : "Template V2 · Editorial Premium") : "Versão Final Editável"}</h1>
        <p className="sub">{locked ? "Preencha os dados e as fotos. Baixe em PNG 1080×1440." : "Troque os dados e as fotos. O preview atualiza na hora — baixe em PNG 1080×1440."}</p>

        <div className="group">
          <div className="gtitle">Corretor</div>
          <Field label="Nome do corretor" value={s.nome} onChange={set("nome")} placeholder="Ex.: Leandro Freitas"/>
          <div className="two">
            <Field label="Cargo" value={s.cargo} onChange={set("cargo")}/>
            <Field label="CRECI" value={s.creci} onChange={set("creci")}/>
          </div>
          <Field label="Telefone" value={s.phone} onChange={set("phone")}/>
          <Field label="Site" value={s.site} onChange={set("site")}/>
        </div>

        <div className="group">
          <div className="gtitle">Localização do imóvel</div>
          <div className="two">
            <Field label="Bairro" value={s.locBairro} onChange={set("locBairro")}/>
            <Field label="Zona / Cidade" value={s.locZona} onChange={set("locZona")}/>
          </div>
        </div>

        <div className="group">
          <div className="gtitle">Fotos</div>
          <Upload label="Foto do imóvel" value={s.imovel} onPick={set("imovel")}
            hint="Use uma foto em alta resolução. Para fotos na horizontal, ajuste o enquadramento horizontal." />
          <div className="slider">
            <label><span>Enquadramento horizontal ↔</span><span>{s.imovelPosX}%</span></label>
            <input type="range" min="0" max="100" value={s.imovelPosX} onChange={(e) => set("imovelPosX")(+e.target.value)}/>
          </div>
          <div className="slider">
            <label><span>Zoom 🔍</span><span>{Math.round(s.imovelZoom * 100)}%</span></label>
            <input type="range" min="100" max="300" step="5" value={Math.round(s.imovelZoom * 100)} onChange={(e) => set("imovelZoom")(+e.target.value / 100)}/>
          </div>
          <div style={{ height: "16px" }}></div>
          <Upload label="Foto do corretor" value={s.agent} onPick={set("agent")}
            hint="Ideal: PNG com fundo removido (recortado), foto vertical e de frente — assim ele encaixa na base da arte sem moldura." />
          <div className="slider">
            <label><span>Subir / descer corretor</span><span>{s.agentOffsetY > 0 ? "+" : ""}{s.agentOffsetY}px</span></label>
            <input type="range" min="-300" max="300" value={s.agentOffsetY} onChange={(e) => set("agentOffsetY")(+e.target.value)}/>
          </div>
          <div className="slider">
            <label><span>Zoom do corretor 🔍</span><span>{Math.round(s.agentZoom * 100)}%</span></label>
            <input type="range" min="50" max="250" step="5" value={Math.round(s.agentZoom * 100)} onChange={(e) => set("agentZoom")(+e.target.value / 100)}/>
          </div>
        </div>

        <div className="group">
          <div className="gtitle">Tipografia</div>
          <div className="slider">
            <label><span>Tamanho do nome</span><span>{s.nameFontSize}px</span></label>
            <input type="range" min="40" max="100" value={s.nameFontSize} onChange={(e) => set("nameFontSize")(+e.target.value)}/>
            <div className="hint">Reduza se o nome for longo e sair dos limites da arte.</div>
          </div>
        </div>

        <button className="reset" onClick={reset}>↺ Restaurar dados originais</button>
      </div>

      <div className="stage">
        <div className="toolbar">
          {!locked && (
            <div className="seg">
              <button className={version === "a" ? "active" : ""} onClick={() => setVersion("a")}>V1 · Faixa Diagonal</button>
              <button className={version === "b" ? "active" : ""} onClick={() => setVersion("b")}>V2 · Editorial</button>
            </div>
          )}
          {locked && <div className="version-label">{version === "a" ? "V1 · Faixa Diagonal" : "V2 · Editorial Premium"}</div>}
          <button className="dl" onClick={download} disabled={busy}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
            {busy ? "Gerando…" : "Baixar PNG 1080×1440"}
          </button>
        </div>

        <Preview><Comp data={data}/></Preview>
      </div>

      {/* hidden full-size export stage */}
      <div className="exportwrap" ref={exportRef}><Comp data={data}/></div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
