import dotenv from "dotenv";
// Forzamos a dotenv a leer las variables en la línea número 1
dotenv.config();

import express from "express";
import cors from "cors";
import { GoogleGenAI, Type } from "@google/genai";
import { Resend } from "resend";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  }),
);
app.use(express.json());

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

// 🛡️ CONSULTA A GOOGLE SAFE BROWSING (fuente autoritativa de amenazas conocidas)
// Devuelve el tipo de amenaza si la URL está en la base de datos de Google, o null si está limpia.
async function checkSafeBrowsing(url) {
  if (!process.env.SAFE_BROWSING_API_KEY) return null; // no configurada, se salta este paso

  try {
    const respuesta = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${process.env.SAFE_BROWSING_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: { clientId: "vigilante-digital", clientVersion: "1.0.0" },
          threatInfo: {
            threatTypes: [
              "MALWARE",
              "SOCIAL_ENGINEERING",
              "UNWANTED_SOFTWARE",
              "POTENTIALLY_HARMFUL_APPLICATION",
            ],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: [{ url }],
          },
        }),
      },
    );

    const data = await respuesta.json();
    if (data.matches && data.matches.length > 0) {
      return data.matches[0].threatType; // ej: "SOCIAL_ENGINEERING"
    }
    return null; // Google no encontró coincidencias: URL limpia
  } catch (err) {
    console.error("⚠️ Error consultando Safe Browsing:", err.message);
    return null; // si la API falla, no bloqueamos por las dudas
  }
}

// 🛡️ CONSULTA A VIRUSTOTAL (segunda opinión: +70 motores antivirus/reputación)
// Devuelve una descripción de la amenaza si varios motores la marcan, o null si está limpia o aún no la conocen.
async function checkVirusTotal(url) {
  if (!process.env.VIRUSTOTAL_API_KEY) return null; // no configurada, se salta este paso

  try {
    // VirusTotal identifica cada URL por su versión en base64 sin el padding "="
    const urlId = Buffer.from(url).toString("base64").replace(/=+$/, "");

    const respuesta = await fetch(
      `https://www.virustotal.com/api/v3/urls/${urlId}`,
      { headers: { "x-apikey": process.env.VIRUSTOTAL_API_KEY } },
    );

    if (respuesta.status === 404) {
      // VirusTotal todavía no analizó esta URL: la mandamos a analizar para la próxima vez
      // (no esperamos el resultado para no frenar al usuario ahora)
      fetch("https://www.virustotal.com/api/v3/urls", {
        method: "POST",
        headers: {
          "x-apikey": process.env.VIRUSTOTAL_API_KEY,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `url=${encodeURIComponent(url)}`,
      }).catch(() => {});
      return null;
    }

    if (!respuesta.ok) return null;

    const data = await respuesta.json();
    const stats = data?.data?.attributes?.last_analysis_stats;
    if (!stats) return null;

    const detecciones = (stats.malicious || 0) + (stats.suspicious || 0);

    // Exigimos al menos 3 motores en coincidencia para evitar falsos positivos de un solo motor
    if (detecciones >= 3) {
      return `${detecciones} motores antivirus marcaron esta URL como maliciosa`;
    }
    return null;
  } catch (err) {
    console.error("⚠️ Error consultando VirusTotal:", err.message);
    return null;
  }
}

// Inicialización estricta de Resend con la variable de entorno ya cargada
const resend = new Resend(process.env.RESEND_API_KEY);

let db;
(async () => {
  try {
    db = await open({
      filename: "./seguridad.db",
      driver: sqlite3.Database,
    });

    await db.exec(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        pin TEXT,
        verification_code TEXT,
        is_verified INTEGER DEFAULT 0
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS historial (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT,
        threat_type TEXT,
        reason TEXT,
        fecha TEXT,
        action TEXT DEFAULT 'Bloqueado'
      )
    `);

    console.log("🗄️ Base de datos SQLite conectada. Tablas listas.");
  } catch (err) {
    console.error("Error inicializando SQLite:", err);
  }
})();

// 🔑 ENDPOINT: INICIAR SESIÓN
app.post("/api/auth/login", async (req, res) => {
  const { email, pin } = req.body;
  if (!email || !pin)
    return res.status(400).json({ error: "Faltan campos obligatorios." });

  try {
    const usuario = await db.get("SELECT * FROM usuarios WHERE email = ?", [
      email,
    ]);
    if (!usuario || usuario.pin !== pin) {
      return res
        .status(401)
        .json({ error: "El correo o el PIN son incorrectos." });
    }
    if (usuario.is_verified === 0) {
      return res
        .status(403)
        .json({ error: "Cuenta no verificada.", requiereVerificacion: true });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error en el servidor." });
  }
});

// ✉️ ENDPOINT: REGISTRO REAL (Envía el correo usando la instancia estricta)
app.post("/api/auth/register", async (req, res) => {
  const { email, pin } = req.body;
  if (!email || !email.includes("@") || !pin || pin.length !== 4) {
    return res.status(400).json({ error: "Datos inválidos." });
  }

  const verificationCode = Math.floor(
    100000 + Math.random() * 900000,
  ).toString();

  try {
    await db.run(
      `INSERT INTO usuarios (email, pin, verification_code, is_verified) VALUES (?, ?, ?, 0)
       ON CONFLICT(email) DO UPDATE SET pin=?, verification_code=?, is_verified=0`,
      [email, pin, verificationCode, pin, verificationCode],
    );

    // LLAMADA ESTÁNDAR REAL A RESEND
    console.log(
      `✉️ Intentando enviar correo electrónico real a través de Resend a: ${email}...`,
    );

    await resend.emails.send({
      from: "Vigilante Digital <onboarding@resend.dev>",
      to: email, // Recuerda ingresar exactamente tu mismo email de registro de Resend
      subject: "🔑 Activa tu Escudo - Código de Verificación",
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
          <h2>¡Bienvenido a Vigilante Digital AI!</h2>
          <p>Para confirmar tu identidad y activar la extensión, ingresa el siguiente código:</p>
          <div style="background: #f1f5f9; padding: 15px; font-size: 26px; font-weight: bold; letter-spacing: 4px; text-align: center; border-radius: 8px; margin: 20px 0; color: #0284c7;">
            ${verificationCode}
          </div>
        </div>
      `,
    });

    console.log(`✅ ¡Correo enviado exitosamente con Resend!`);
    res.json({ success: true, message: "Código enviado correctamente." });
  } catch (error) {
    console.error("❌ Error real al enviar con Resend:", error);
    res.status(500).json({
      error: "Fallo el servicio de mensajería externo al enviar el correo.",
    });
  }
});

// 🔑 ENDPOINT: VERIFICACIÓN OTP ESTÁNDAR
app.post("/api/auth/verify", async (req, res) => {
  const { email, code } = req.body;
  try {
    const usuario = await db.get("SELECT * FROM usuarios WHERE email = ?", [
      email,
    ]);
    if (!usuario || usuario.verification_code !== code) {
      return res
        .status(400)
        .json({ success: false, error: "Código incorrecto." });
    }
    await db.run(
      "UPDATE usuarios SET is_verified = 1, verification_code = NULL WHERE email = ?",
      [email],
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error de validación." });
  }
});

// 🕵️‍♂️ ENDPOINT: ANALIZADOR DE HISTORIAL (GEMINI)
// 🕵️‍♂️ ENDPOINT: ANALIZADOR DE INGENIERÍA SOCIAL E IDENTIDAD CRUZADA (REFORZADO)
// 🕵️‍♂️ ENDPOINT: ANALIZADOR FORENSE BLINDADO CONTRA FALLOS DE RED Y APIS
// 🕵️‍♂️ ENDPOINT: ANALIZADOR COMPACTO BLINDADO CONTRA MINIFICACIÓN
// 🕵️‍♂️ ENDPOINT: ANALIZADOR FORENSE INDESTRUCTIBLE PARA LA DEMO
app.post("/api/analyze", async (req, res) => {
  try {
    const { textContent, currentUrl } = req.body;
    const fechaActual = new Date().toLocaleString();

    console.log(`\n🔍 [Auditoría Forense] Analizando: ${currentUrl}`);

    // 1. GOOGLE SAFE BROWSING + VIRUSTOTAL EN PARALELO (fuentes autoritativas de reputación de URLs)
    const [threatSafeBrowsing, threatVirusTotal] = await Promise.all([
      checkSafeBrowsing(currentUrl),
      checkVirusTotal(currentUrl),
    ]);

    if (threatSafeBrowsing || threatVirusTotal) {
      const fuente = threatSafeBrowsing ? "Google Safe Browsing" : "VirusTotal";
      const detalle = threatSafeBrowsing || threatVirusTotal;
      console.log(`⚠️ [${fuente}] URL marcada: ${detalle}`);
      const reporte = {
        isThreat: true,
        score: 99,
        threatType: threatSafeBrowsing || "Reputación Maliciosa",
        reason: `${fuente} identificó esta URL como una amenaza conocida (${detalle}).`,
      };
      try {
        await db.run(
          `INSERT INTO historial (url, threat_type, reason, fecha, action) VALUES (?, ?, ?, ?, 'Bloqueado')`,
          [currentUrl, reporte.threatType, reporte.reason, fechaActual],
        );
      } catch (dbErr) {
        console.error("Error guardando historial en SQLite:", dbErr);
      }
      return res.json(reporte);
    }

    // 2. Si ninguna de las dos encontró nada, analizamos el contexto del texto con Gemini
    if (ai && process.env.GEMINI_API_KEY) {
      try {
        const prompt = `Analiza si la URL y el texto presentan phishing o fraude REAL. No confundas con contenido normal de redes sociales, publicidad o e-commerce legítimo (ej: promociones, "envío gratis", notificaciones de la propia plataforma). Solo marca isThreat=true si hay indicios claros de engaño (suplantación de identidad, solicitud urgente de datos/dinero, dominio sospechoso, etc). URL: ${currentUrl} Texto: "${textContent}"`;
        const response = await ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                isThreat: { type: Type.BOOLEAN },
                score: { type: Type.INTEGER },
                threatType: { type: Type.STRING },
                reason: { type: Type.STRING },
              },
              required: ["isThreat", "score", "threatType", "reason"],
            },
          },
        });

        const securityReport = JSON.parse(response.text);

        if (securityReport.isThreat && securityReport.score >= 60) {
          await db.run(
            `INSERT INTO historial (url, threat_type, reason, fecha, action) VALUES (?, ?, ?, ?, 'Bloqueado')`,
            [
              currentUrl,
              securityReport.threatType,
              securityReport.reason,
              fechaActual,
            ],
          );
        }

        return res.json(securityReport);
      } catch (geminiError) {
        console.error(
          "❌ Fallo controlado en Gemini API:",
          geminiError.message,
        );
      }
    }

    // 3. Sin coincidencias en Safe Browsing y sin respuesta válida de Gemini: NO se marca como amenaza.
    // (Antes esto forzaba isThreat:true "por las dudas" — eso era la causa de los falsos positivos)
    return res.json({
      isThreat: false,
      score: 0,
      threatType: "Ninguna",
      reason: "No se detectaron indicios de phishing o fraude en esta página.",
    });
  } catch (fatalError) {
    console.error("💥 Error crítico en el servidor:", fatalError);
    return res.json({
      isThreat: false,
      score: 0,
      threatType: "Error",
      reason: "Ocurrió un error al analizar. No se bloqueó por precaución.",
    });
  }
});

app.get("/api/history", async (req, res) => {
  try {
    const list = await db.all(
      "SELECT * FROM historial ORDER BY id DESC LIMIT 10",
    );
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: "Error." });
  }
});

app.post("/api/history/update-action", async (req, res) => {
  const { url } = req.body;
  try {
    await db.run(
      `UPDATE historial SET action = 'Ingresado (Riesgo)' WHERE url = ?`,
      [url],
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Error." });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 Servidor estricto corriendo en puerto ${PORT}`),
);
