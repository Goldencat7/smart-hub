/* global React */
function VendidoB({ data }){
  const d = Object.assign({}, window.VENDIDO_DEFAULTS, data || {});
  return (
    <div className="vendido v2" data-screen-label="V2">
      {/* navy top bar */}
      <div className="v2-topbar">
        <img className="v2-logo-top" src={(window.REMAX_ASSETS||{}).logoWhite||'assets/remax-smart-logo-white.png'} alt="REMAX Smart"/>
        <span className="v2-creci">{d.creci}</span>
      </div>

      {/* property photo card */}
      <div className="v2-card">
        <img className="v2-photo" src={d.imovel} alt="Imóvel vendido" style={{ objectPosition: (d.imovelPosX||50) + "% 50%", transform: "scale(" + (d.imovelZoom||1) + ")", transformOrigin: "50% 50%" }}/>
        <div className="v2-sash"><span>VENDIDO</span></div>
      </div>

      {/* location */}
      <div className="v2-loc">{d.locBairro} <span>/</span> {d.locZona}</div>

      {/* agent — left, grounded with soft fade */}
      <img className="v2-agent" src={d.agent} alt={d.name1 + " " + d.name2} style={{ transform: "translateY(" + (d.agentOffsetY||0) + "px) scale(" + (d.agentZoom||1) + ")", transformOrigin: "50% 100%" }}/>

      {/* identity + contact */}
      <div className="v2-id">
        <div className="v2-eyebrow">IMÓVEL VENDIDO</div>
        <h1 className="v2-name" style={{ fontSize: (d.nameFontSize || 86) + "px" }}>{d.name1}<br/>{d.name2}</h1>
        <div className="v2-role">{d.cargo} de Imóveis</div>
        <div className="v2-rule"></div>
        <div className="v2-phone">{d.phone}</div>
        <div className="v2-site">{d.site}</div>
      </div>
    </div>
  );
}
window.VendidoB = VendidoB;
