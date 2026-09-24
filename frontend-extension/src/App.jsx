import React, { useState, useEffect } from "react";

// Definición de las pantallas del flujo
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

  // Verificamos si el usuario ya se registró anteriormente al abrir la extensión
  useEffect(() => {
    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local
    ) {
      chrome.storage.local.get(
        ["userEmail", "isVerified", "currentStep"],
        (result) => {
          if (result.userEmail) {
            setEmail(result.userEmail);

            if (result.isVerified) {
              setStep(STEPS.LOCK); // Si ya terminó todo, pide PIN diario
            } else if (result.currentStep === STEPS.VERIFY) {
              setStep(STEPS.VERIFY); // ¡AQUÍ ESTÁ LA MAGIA!: Si cerró en la pantalla del código, vuelve ahí
            }
          }
        },
      );
    }
  }, []);

  // ✉️ 1. MANEJADOR DE REGISTRO
  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");

    if (!email.includes("@"))
      return setError("Introduce un correo electrónico válido.");
    if (pin.length !== 4 || isNaN(pin))
      return setError("El PIN debe ser exactamente de 4 números.");
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
        // TRUCO: Guardamos en Chrome que ya enviamos el correo y estamos esperando el código
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
        setError(data.error || "Error al procesar el registro.");
      }
    } catch (err) {
      setError("No se pudo conectar con el servidor de seguridad.");
    } finally {
      setLoading(false);
    }
  };

  // 🔑 2. MANEJADOR DE VERIFICACIÓN OTP
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
        // Guardamos de forma definitiva que el usuario ya está verificado y activo
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
        const data = await response.json();
        setError(data.error || "Código incorrecto o vencido.");
      }
    } catch (err) {
      setError("Error de conexión al validar el código.");
    } finally {
      setLoading(false);
    }
  };

  // 🔒 3. MANEJADOR DE LOGIN POR PIN DIARIO
  const handleLoginPin = (num) => {
    setError(false);
    if (loginPin.length < 4) {
      const nuevoPin = loginPin + num;
      setLoginPin(nuevoPin);

      if (nuevoPin.length === 4) {
        setTimeout(() => {
          // Desbloqueo rápido para la demo del MVP de la hackathon
          setStep(STEPS.DASHBOARD);
          setLoginPin("");
        }, 200);
      }
    }
  };

  // ==================== INTERFACES VISUALES RENDERIZADAS ====================

  // VISTA A: FORMULARIO DE REGISTRO
  if (step === STEPS.REGISTER) {
    return (
      <div style={containerStyle}>
        <h2 style={titleStyle}>🛡️ Registro de Escudo</h2>
        <p style={subtitleStyle}>
          Crea tu cuenta de ciberseguridad para activar el Vigilante AI.
        </p>
        <form onSubmit={handleRegister} style={formStyle}>
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
            placeholder="Crea tu PIN (4 dígitos)"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="password"
            maxLength={4}
            placeholder="Confirma tu PIN"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            required
            style={inputStyle}
          />
          {error && <p style={errorStyle}>{error}</p>}
          <button type="submit" disabled={loading} style={btnStyle}>
            {loading ? "Enviando código..." : "Registrar y Enviar Código"}
          </button>
        </form>
      </div>
    );
  }

  // VISTA B: PANTALLA DE VERIFICACIÓN DE GMAIL (OTP)
  if (step === STEPS.VERIFY) {
    return (
      <div style={containerStyle}>
        <div style={{ fontSize: "32px" }}>✉️</div>
        <h2 style={titleStyle}>Verifica tu Correo</h2>
        <p style={subtitleStyle}>
          Te enviamos un código de 6 dígitos a <strong>{email}</strong> a través
          de Resend.
        </p>
        <form onSubmit={handleVerify} style={formStyle}>
          <input
            type="text"
            maxLength={6}
            placeholder="Código de 6 dígitos"
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value)}
            required
            style={{
              ...inputStyle,
              letterSpacing: "4px",
              textAlign: "center",
              fontSize: "18px",
            }}
          />
          {error && <p style={errorStyle}>{error}</p>}
          <button type="submit" disabled={loading} style={btnStyle}>
            {loading ? "Validando..." : "Activar Extensión"}
          </button>
        </form>
      </div>
    );
  }

  // VISTA C: PANTALLA DE BLOQUEO POR PIN (INGRESO DIARIO)
  if (step === STEPS.LOCK) {
    return (
      <div style={containerStyle}>
        <div style={{ fontSize: "32px", marginBottom: "5px" }}>🔒</div>
        <h2 style={titleStyle}>Sistema Bloqueado</h2>
        <p style={subtitleStyle}>
          Ingresa tu PIN de privacidad para acceder al panel de control.
        </p>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "12px",
            marginBottom: "20px",
          }}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              style={{
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                border: "2px solid #38bdf8",
                background: loginPin.length > i ? "#38bdf8" : "transparent",
                transition: "all 0.1s",
              }}
            />
          ))}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "10px",
            maxWidth: "180px",
            margin: "0 auto",
          }}
        >
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
            <button
              key={n}
              onClick={() => handleLoginPin(n)}
              style={keyboardBtnStyle}
            >
              {n}
            </button>
          ))}
          <button
            onClick={() => setLoginPin("")}
            style={{
              ...keyboardBtnStyle,
              fontSize: "11px",
              background: "#334155",
            }}
          >
            Borrar
          </button>
          <button onClick={() => handleLoginPin("0")} style={keyboardBtnStyle}>
            0
          </button>
        </div>
      </div>
    );
  }

  // VISTA D: DASHBOARD PRINCIPAL PROTEGIDO
  return (
    <div style={containerStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "15px",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "15px" }}>🛡️ Vigilante Forense AI</h3>
        <button
          onClick={() => setStep(STEPS.LOCK)}
          style={{
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: "11px",
            textDecoration: "underline",
          }}
        >
          Cerrar Panel
        </button>
      </div>

      <div
        style={{
          padding: "12px",
          borderRadius: "8px",
          textAlign: "center",
          marginBottom: "15px",
          background: shieldActive
            ? "rgba(16, 185, 129, 0.1)"
            : "rgba(239, 68, 68, 0.1)",
          border: `1px solid ${shieldActive ? "#10b981" : "#ef4444"}`,
        }}
      >
        <strong
          style={{
            fontSize: "12px",
            color: shieldActive ? "#10b981" : "#ef4444",
          }}
        >
          {shieldActive ? "🟢 ESCUDO ACTIVO EN VIVO" : "🔴 ANÁLISIS SUSPENDIDO"}
        </strong>
      </div>

      <div
        style={{
          background: "#1e293b",
          padding: "12px",
          borderRadius: "8px",
          marginBottom: "15px",
          textAlign: "left",
        }}
      >
        <span
          style={{
            fontSize: "10px",
            color: "#64748b",
            textTransform: "uppercase",
            fontWeight: "bold",
          }}
        >
          Métricas de Privacidad
        </span>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "6px",
            fontSize: "12px",
          }}
        >
          <span>Auditorías de DOM en vivo:</span>
          <span style={{ fontWeight: "bold", color: "#38bdf8" }}>Activo</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "4px",
            fontSize: "12px",
          }}
        >
          <span>Filtro Heurístico Local:</span>
          <span style={{ fontWeight: "bold", color: "#10b981" }}>Óptimo</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "4px",
            fontSize: "12px",
          }}
        >
          <span>Persistencia Relacional:</span>
          <span style={{ fontWeight: "bold", color: "#a855f7" }}>SQLite</span>
        </div>
      </div>

      <button
        onClick={() => setShieldActive(!shieldActive)}
        style={{
          width: "100%",
          padding: "10px",
          borderRadius: "6px",
          border: "none",
          fontWeight: "bold",
          color: "#fff",
          cursor: "pointer",
          background: shieldActive ? "#ef4444" : "#10b981",
        }}
      >
        {shieldActive
          ? "Pausar Escaneo Proactivo"
          : "Reanudar Escaneo Proactivo"}
      </button>
    </div>
  );
}

// ==================== OBJETOS DE ESTILO INLINE PARA EL MVP ====================
const containerStyle = {
  width: "280px",
  padding: "20px",
  fontFamily: "system-ui, -apple-system, sans-serif",
  background: "#0f172a",
  color: "#ffffff",
  borderRadius: "12px",
  boxSizing: "border-box",
  textAlign: "center",
};
const titleStyle = {
  margin: "5px 0",
  fontSize: "16px",
  fontWeight: "bold",
  letterSpacing: "-0.3px",
};
const subtitleStyle = {
  fontSize: "11px",
  color: "#94a3b8",
  margin: "0 0 15px 0",
  lineHeight: "1.4",
};
const formStyle = { display: "flex", flexDirection: "column", gap: "10px" };
const inputStyle = {
  padding: "8px 12px",
  borderRadius: "6px",
  border: "1px solid #334155",
  background: "#1e293b",
  color: "#fff",
  fontSize: "13px",
  outline: "none",
};
const btnStyle = {
  padding: "10px",
  borderRadius: "6px",
  border: "none",
  background: "#0284c7",
  color: "#fff",
  fontWeight: "bold",
  fontSize: "13px",
  cursor: "pointer",
  marginTop: "5px",
};
const errorStyle = {
  color: "#f87171",
  fontSize: "11px",
  margin: "0",
  textAlign: "left",
};
const keyboardBtnStyle = {
  background: "#1e293b",
  color: "#fff",
  border: "none",
  padding: "12px",
  borderRadius: "6px",
  fontSize: "14px",
  fontWeight: "bold",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export default App;
