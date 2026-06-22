/* global React */
function VendidoA({ data }){
  const d = Object.assign({}, window.VENDIDO_DEFAULTS, data || {});
  return (
    <div className="vendido v1" data-screen-label="V1">
      {/* property photo — the hero */}
      <div className="v1-photowrap">
        <img className="v1-photo" src={d.imovel} alt="Imóvel vendido" style={{ objectPosition: (d.imovelPosX||50) + "% 50%", transform: "scale(" + (d.imovelZoom||1) + ")", transformOrigin: "50% 50%" }}/>
        <div className="v1-photo-scrim"></div>
      </div>

      {/* brand balloon */}
      <img className="v1-balloon" src={(window.REMAX_ASSETS||{}).balloon||'assets/remax-balloon.png'} alt="REMAX"/>

      {/* VENDIDO stamp — centered top */}
      <div className="v1-stamp">
        <span className="v1-stamp-kicker">IMÓVEL</span>
        <span className="v1-stamp-word">VENDIDO</span>
      </div>

      {/* agent anchored bottom-left, emerging from the navy */}
      <img className="v1-agent" src={d.agent} alt={d.name1 + " " + d.name2} style={{ transform: "translateY(" + (d.agentOffsetY||0) + "px) scale(" + (d.agentZoom||1) + ")", transformOrigin: "50% 100%" }}/>

      {/* identity block */}
      <div className="v1-id">
        <div className="v1-eyebrow">{d.locBairro} <i className="v1-dot"></i> {d.locZona}</div>
        <h1 className="v1-name" style={{ fontSize: (d.nameFontSize || 82) + "px" }}>{d.name1}<br/>{d.name2}</h1>
        <div className="v1-role">{d.cargo} <span>·</span> REMAX Smart</div>
        <div className="v1-creci">{d.creci}</div>
      </div>

      {/* footer */}
      <div className="v1-footer">
        <img className="v1-logo" src={(window.REMAX_ASSETS||{}).logoWhite||'assets/remax-smart-logo-white.png'} alt="REMAX Smart"/>
        <div className="v1-contact">
          <span className="v1-phone">{d.phone}</span>
          <span className="v1-site">{d.site}</span>
        </div>
      </div>
    </div>
  );
}
window.VendidoA = VendidoA;
