import React, { useState, useEffect } from "react";

const STEPS = {
  REGISTER: "REGISTER",
  VERIFY: "VERIFY",
  LOCK: "LOCK",
  DASHBOARD: "DASHBOARD",
};

function App() {
  const [step, setStep] = useState(STEPS.REGISTER);
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shieldActive, setShieldActive] = useState(true);
  const [historyList, setHistoryList] = useState([]);
  const [isRegistering, setIsRegistering] = useState(true);

  // 🔄 ARRANQUE INTELIGENTE: Recupera el estado exacto pase lo que pase al cerrar la ventana
  useEffect(() => {
    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local
    ) {
      chrome.storage.local.get(
        ["userEmail", "isVerified", "currentStep", "haTenidoCuenta"],
        (result) => {
          if (result.userEmail) {
            setEmail(result.userEmail);

            if (result.isVerified) {
              setStep(STEPS.LOCK); // Si ya inició sesión, pide PIN diario
            } else if (result.currentStep === STEPS.VERIFY) {
              setStep(STEPS.VERIFY); // ¡BLINDAJE!: Si cerró la pestaña esperando el código, se queda acá
            }
          } else if (result.haTenidoCuenta) {
            setIsRegistering(false); // Si cerró sesión, muestra login automático
            setStep(STEPS.REGISTER);
          }
        },
      );
    }
  }, []);

  // 🗄️ Carga el historial desde la base de datos SQLite
  const cargarHistorial = async () => {
    try {
      const res = await fetch("http://localhost:5000/api/history");
      if (res.ok) {
        const data = await res.json();
        setHistoryList(data);
      }
    } catch (err) {
      console.error("Error cargando historial de BD:", err);
    }
  };

  useEffect(() => {
    if (step === STEPS.DASHBOARD) {
      cargarHistorial();
    }
  }, [step]);

  // ✉️ MANEJADOR DE REGISTRO (Guarda el paso temporal de verificación)
  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");

    if (!email.includes("@")) return setError("Introduce un correo válido.");
    if (pin.length !== 4 || isNaN(pin))
      return setError("El PIN debe ser de 4 números.");
    if (pin !== confirmPin)
      return setError("Los PINes ingresados no coinciden.");

    setLoading(true);
    try {
      const response = await fetch("http://localhost:5000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, pin }),
      });

      if (response.ok) {
        // Guardamos inmediatamente el paso para blindar el Popup contra clics afuera
        if (
          typeof chrome !== "undefined" &&
          chrome.storage &&
          chrome.storage.local
        ) {
          chrome.storage.local.set({
            userEmail: email,
            currentStep: STEPS.VERIFY,
          });
        }
        setStep(STEPS.VERIFY);
      } else {
        const data = await response.json();
        setError(data.error || "Error en el registro.");
      }
    } catch (err) {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setLoading(false);
    }
  };

  // 🔑 MANEJADOR DE INICIO DE SESIÓN (LOGIN AUTOMÁTICO)
  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("http://localhost:5000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, pin }),
      });
      const data = await response.json();

      if (response.ok) {
        if (
          typeof chrome !== "undefined" &&
          chrome.storage &&
          chrome.storage.local
        ) {
          chrome.storage.local.set({
            userEmail: email,
            isVerified: true,
            currentStep: STEPS.DASHBOARD,
          });
        }
        setStep(STEPS.DASHBOARD);
      } else {
        if (response.status === 403 && data.requiereVerificacion) {
          setStep(STEPS.VERIFY);
        } else {
          setError(data.error || "Credenciales incorrectas.");
        }
      }
    } catch (err) {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setLoading(false);
    }
  };

  // 🔢 MANEJADOR DE VERIFICACIÓN DE CÓDIGO (OTP)
  const handleVerify = async (e) => {
    e.preventDefault();
    setError("");
    if (otpCode.length !== 6 || isNaN(otpCode))
      return setError("El código debe ser de 6 números.");

    setLoading(true);
    try {
      const response = await fetch("http://localhost:5000/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: otpCode }),
      });

      if (response.ok) {
        if (
          typeof chrome !== "undefined" &&
          chrome.storage &&
          chrome.storage.local
        ) {
          chrome.storage.local.set({
            userEmail: email,
            isVerified: true,
            currentStep: STEPS.DASHBOARD,
          });
        }
        setStep(STEPS.DASHBOARD);
      } else {
        setError("Código incorrecto o vencido.");
      }
    } catch (err) {
      setError("Error al validar el código.");
    } finally {
      setLoading(false);
    }
  };

  // 🔒 MANEJADOR DE TECLADO NUMÉRICO DIARIO
  const handleLoginPin = (num) => {
    setError(false);
    if (loginPin.length < 4) {
      const nuevoPin = loginPin + num;
      setLoginPin(nuevoPin);
      if (nuevoPin.length === 4) {
        setTimeout(() => {
          setStep(STEPS.DASHBOARD);
          setLoginPin("");
        }, 200);
      }
    }
  };

  // 🚪 MANEJADOR DE CERRAR SESIÓN INTELIGENTE
  const handleLogout = () => {
    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local
    ) {
      chrome.storage.local.clear(() => {
        chrome.storage.local.set({ haTenidoCuenta: true });
        setEmail("");
        setPin("");
        setConfirmPin("");
        setOtpCode("");
        setLoginPin("");
        setIsRegistering(false);
        setStep(STEPS.REGISTER);
      });
    } else {
      setIsRegistering(false);
      setStep(STEPS.REGISTER);
    }
  };

  // ==================== INTERFACES VISUALES RENDERIZADAS ====================

  // VISTA A: FORMULARIO AUTOMÁTICO (MUTANTE ENTRE REGISTRO O LOGIN)
  if (step === STEPS.REGISTER) {
    return (
      <div style={containerStyle}>
        <h2 style={titleStyle}>
          {isRegistering ? "🛡️ Registro de Escudo" : "🔑 Iniciar Sesión"}
        </h2>
        <p style={subtitleStyle}>
          {isRegistering
            ? "Crea tu cuenta para activar el Vigilante AI."
            : "Coloca tus credenciales para reanudar el escudo."}
        </p>
        <form
          onSubmit={isRegistering ? handleRegister : handleLogin}
          style={formStyle}
        >
          <input
            type="email"
            placeholder="Tu Gmail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="password"
            maxLength={4}
            placeholder="PIN de 4 dígitos"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            required
            style={inputStyle}
          />
          {isRegistering && (
            <input
              type="password"
              maxLength={4}
              placeholder="Confirma tu PIN"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              required
              style={inputStyle}
            />
          )}
          {error && <p style={errorStyle}>{error}</p>}
          <button type="submit" disabled={loading} style={btnStyle}>
            {loading
              ? "Procesando..."
              : isRegistering
                ? "Registrar Cuenta"
                : "Ingresar al Escudo"}
          </button>
          <button
            type="button"
            onClick={() => {
              setError("");
              setPin("");
              setConfirmPin("");
              setIsRegistering(!isRegistering);
            }}
            style={btnBackStyle}
          >
            {isRegistering
              ? "¿Ya tenés cuenta? Iniciar sesión"
              : "¿No tenés cuenta? Regístrate"}
          </button>
        </form>
      </div>
    );
  }

  // VISTA B: PANTALLA DE VERIFICACIÓN DE GMAIL (OTP) -> ¡BLINDADA Y CON BOTÓN ATRÁS!
  if (step === STEPS.VERIFY) {
    return (
      <div style={containerStyle}>
        <div style={{ fontSize: "24px" }}>✉️</div>
        <h2 style={titleStyle}>Verifica tu Correo</h2>
        <p style={subtitleStyle}>
          Ingresa el código que figura en tu terminal de Node para{" "}
          <strong>{email}</strong>.
        </p>
        <form onSubmit={handleVerify} style={formStyle}>
          <input
            type="text"
            maxLength={6}
            placeholder="000000"
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value)}
            required
            style={{ ...inputStyle, letterSpacing: "4px", textAlign: "center" }}
          />
          {error && <p style={errorStyle}>{error}</p>}
          <button type="submit" disabled={loading} style={btnStyle}>
            {loading ? "Verificando..." : "Confirmar Activación"}
          </button>
          <button
            type="button"
            onClick={() => setStep(STEPS.REGISTER)}
            style={btnBackStyle}
          >
            ⬅️ Volver y cambiar correo
          </button>
        </form>
      </div>
    );
  }

  // VISTA C: PANTALLA DE BLOQUEO POR PIN (INGRESO DIARIO)
  if (step === STEPS.LOCK) {
    return (
      <div style={containerStyle}>
        <div style={{ fontSize: "24px" }}>🔒</div>
        <h2 style={titleStyle}>Sistema Bloqueado</h2>
        <p style={subtitleStyle}>Coloca tu PIN para entrar al panel.</p>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "8px",
            marginBottom: "15px",
          }}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                border: "2px solid #38bdf8",
                background: loginPin.length > i ? "#38bdf8" : "transparent",
              }}
            />
          ))}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "8px",
            maxWidth: "160px",
            margin: "0 auto 10px auto",
          }}
        >
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
            <button
              key={n}
              onClick={() => handleLoginPin(n)}
              style={numBtnStyle}
            >
              {n}
            </button>
          ))}
          <button
            onClick={() => setLoginPin("")}
            style={{ ...numBtnStyle, fontSize: "10px", background: "#334155" }}
          >
            Borrar
          </button>
          <button onClick={() => handleLoginPin("0")} style={numBtnStyle}>
            0
          </button>
        </div>
        <button
          onClick={handleLogout}
          style={{
            background: "transparent",
            border: "none",
            color: "#64748b",
            cursor: "pointer",
            fontSize: "11px",
            textDecoration: "underline",
          }}
        >
          Restablecer desde cero
        </button>
      </div>
    );
  }

  // VISTA D: DASHBOARD PRINCIPAL CON EL HISTORIAL Y LOGOUT REMOTO
  return (
    <div style={containerStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "10px",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "13px" }}>🛡️ Vigilante Forense AI</h3>
        <button
          onClick={() => setStep(STEPS.LOCK)}
          style={{
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: "10px",
          }}
        >
          Bloquear
        </button>
      </div>

      <div
        style={{
          padding: "8px",
          borderRadius: "6px",
          textAlign: "center",
          marginBottom: "10px",
          background: shieldActive
            ? "rgba(16, 185, 129, 0.1)"
            : "rgba(239, 68, 68, 0.1)",
          border: `1px solid ${shieldActive ? "#10b981" : "#ef4444"}`,
        }}
      >
        <strong
          style={{
            fontSize: "11px",
            color: shieldActive ? "#10b981" : "#ef4444",
          }}
        >
          {shieldActive ? "🟢 ESCUDO ACTIVO EN VIVO" : "🔴 ESCANEO PAUSADO"}
        </strong>
      </div>

      {/* RECUADRO DEL HISTORIAL DINÁMICO */}
      <div
        style={{
          background: "#1e293b",
          padding: "10px",
          borderRadius: "8px",
          marginBottom: "12px",
          textAlign: "left",
          maxHeight: "180px",
          overflowY: "auto",
        }}
      >
        <span
          style={{
            fontSize: "10px",
            color: "#64748b",
            textTransform: "uppercase",
            fontWeight: "bold",
            display: "block",
            marginBottom: "6px",
          }}
        >
          🛡️ Historial de Amenazas (BD)
        </span>

        {historyList.length === 0 ? (
          <p
            style={{
              fontSize: "11px",
              color: "#94a3b8",
              margin: "5px 0 0 0",
              textAlign: "center",
            }}
          >
            Ninguna amenaza detectada hoy. ¡Sitio seguro!
          </p>
        ) : (
          historyList.map((item) => (
            <div
              key={item.id}
              style={{
                borderBottom: "1px solid #334155",
                paddingBottom: "6px",
                marginBottom: "6px",
                fontSize: "11px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontWeight: "bold",
                  color: "#f87171",
                }}
              >
                <span>⚠️ {item.threat_type}</span>
                <span style={{ fontSize: "9px", color: "#64748b" }}>
                  {item.action}
                </span>
              </div>
              <div
                style={{
                  color: "#cbd5e1",
                  fontSize: "10px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  margin: "2px 0",
                }}
              >
                <strong>URL:</strong> {item.url}
              </div>
              <div
                style={{
                  color: "#94a3b8",
                  fontSize: "10px",
                  background: "#0f172a",
                  padding: "4px",
                  borderRadius: "4px",
                  marginTop: "2px",
                }}
              >
                <strong>Razón:</strong> {item.reason}
              </div>
            </div>
          ))
        )}
      </div>

      <button
        onClick={() => setShieldActive(!shieldActive)}
        style={{
          width: "100%",
          padding: "8px",
          borderRadius: "6px",
          border: "none",
          fontWeight: "bold",
          color: "#fff",
          cursor: "pointer",
          background: shieldActive ? "#ef4444" : "#10b981",
          marginBottom: "8px",
          fontSize: "12px",
        }}
      >
        {shieldActive ? "Pausar Escudo" : "Activar Escudo"}
      </button>

      <button onClick={handleLogout} style={btnLogoutStyle}>
        🚪 Cerrar Sesión (Limpiar Cuenta)
      </button>
    </div>
  );
}

// ==================== ENTORNO DE ESTILOS DUAL ADAPTATIVO (POPUP + PESTAÑA) ====================
const containerStyle = {
  width: "100%",
  minHeight: "400px",
  padding: "20px 16px",
  fontFamily: "system-ui, -apple-system, sans-serif",
  background: "#0f172a",
  color: "#ffffff",
  boxSizing: "border-box",
  textAlign: "center",
  margin: 0,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
};
const titleStyle = { margin: "2px 0", fontSize: "14px", fontWeight: "bold" };
const subtitleStyle = {
  fontSize: "10px",
  color: "#94a3b8",
  margin: "0 0 10px 0",
};
const formStyle = { display: "flex", flexDirection: "column", gap: "8px" };
const inputStyle = {
  padding: "8px",
  borderRadius: "4px",
  border: "1px solid #334155",
  background: "#1e293b",
  color: "#fff",
  fontSize: "12px",
};
const btnStyle = {
  padding: "8px",
  borderRadius: "4px",
  border: "none",
  background: "#0284c7",
  color: "#fff",
  fontWeight: "bold",
  fontSize: "12px",
  cursor: "pointer",
};
const btnBackStyle = {
  padding: "6px",
  borderRadius: "4px",
  border: "1px solid #334155",
  background: "transparent",
  color: "#64748b",
  fontSize: "11px",
  cursor: "pointer",
  marginTop: "4px",
};
const btnLogoutStyle = {
  padding: "6px",
  borderRadius: "4px",
  border: "none",
  background: "#334155",
  color: "#f87171",
  fontWeight: "bold",
  fontSize: "11px",
  cursor: "pointer",
  width: "100%",
};
const errorStyle = { color: "#f87171", fontSize: "10px", margin: "0" };
const numBtnStyle = {
  background: "#1e293b",
  color: "#fff",
  border: "none",
  padding: "10px",
  borderRadius: "4px",
  fontSize: "12px",
  fontWeight: "bold",
  cursor: "pointer",
};

export default App;
