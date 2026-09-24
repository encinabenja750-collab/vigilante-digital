const PALABRAS_SOSPECHOSAS = [
  "suspension",
  "bloqueo",
  "urgente",
  "verificar cuenta",
  "actualizar pago",
  "iniciar sesion",
  "premio",
  "ganaste",
  "litecoin gratis",
  "duplica tus criptos",
  "deposito minimo",
  "ingresa tus datos",
  "token expirado",
  "alerta de seguridad",
];

let ultimoEscaneo = 0;
const COOLDOWN = 3000;

async function escanearPantalla() {
  const ahora = Date.now();
  if (ahora - ultimoEscaneo < COOLDOWN) return;
  ultimoEscaneo = ahora;

  const textoPantalla = document.body.innerText.toLowerCase();
  const urlActual = window.location.href;

  const contieneGatillo = PALABRAS_SOSPECHOSAS.some((p) =>
    textoPantalla.includes(p),
  );

  if (contieneGatillo) {
    const muestraTexto = document.body.innerText.substring(0, 1500);
    try {
      const response = await fetch("http://localhost:5000/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          textContent: muestraTexto,
          currentUrl: urlActual,
        }),
      });
      const data = await response.json();
      if (data.isThreat && data.score >= 60) {
        inyectarCortinaBloqueo(data.threatType, data.reason);
      }
    } catch (err) {
      console.error("Error en módulo Vigilante AI:", err);
    }
  }
}

function iniciarObservador() {
  window.addEventListener("load", () => setTimeout(escanearPantalla, 1500));
  const observer = new MutationObserver(() => escanearPantalla());
  observer.observe(document.body, { childList: true, subtree: true });
}

function inyectarCortinaBloqueo(tipo, motivo) {
  if (document.getElementById("vigilante-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "vigilante-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100vw",
    height: "100vh",
    backgroundColor: "rgba(15, 23, 42, 0.98)",
    zIndex: "99999999",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    fontFamily: "system-ui, sans-serif",
    color: "#fff",
    padding: "20px",
  });

  overlay.innerHTML = `
    <div style="text-align: center; max-width: 500px; background: #1e293b; padding: 35px; border-radius: 12px; border: 2px solid #ef4444; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);">
      <h1 style="color: #ef4444; margin-top: 0; font-size: 22px;">⚠️ AMENAZA DIGITAL DETECTADA</h1>
      <p style="background: rgba(239, 68, 68, 0.2); padding: 8px; border-radius: 4px; color: #f87171; font-weight: bold; font-size: 13px;">
        Clasificación: ${tipo}
      </p>
      <p style="text-align: left; color: #94a3b8; font-size: 14px; line-height: 1.5; margin: 15px 0;">
        <strong>Análisis Forense de IA:</strong> ${motivo}
      </p>
      <button id="btn-salir" style="background: #ef4444; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; cursor: pointer; margin-top: 10px; width: 100%;">
        Salir de este sitio de forma segura
      </button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("btn-salir").onclick = () =>
    (window.location.href = "https://google.com");
}

iniciarObservador();
