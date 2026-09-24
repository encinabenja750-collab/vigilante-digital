import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { Resend } from "resend";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Inicialización segura de APIs
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// Conexión e Inicialización de la Base de Datos SQL
let db;
(async () => {
  db = await open({
    filename: "./seguridad.db",
    driver: sqlite3.Database,
  });

  // Creamos la tabla de usuarios si no existe
  await db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      pin TEXT,
      verification_code TEXT,
      is_verified INTEGER DEFAULT 0
    )
  `);
  console.log("🗄️ Base de datos SQLite conectada y tablas listas.");
})();

// ✉️ 1. ENDPOINT: REGISTRO Y ENVÍO DE CORREO (Guarda en la BD)
app.post("/api/auth/register", async (req, res) => {
  const { email, pin } = req.body;

  if (!email || !email.includes("@") || !pin || pin.length !== 4) {
    return res
      .status(400)
      .json({ error: "Datos inválidos. El PIN debe ser de 4 dígitos." });
  }

  const verificationCode = Math.floor(
    100000 + Math.random() * 900000,
  ).toString();

  try {
    // Insertamos o actualizamos el usuario en la Base de Datos usando SQL
    await db.run(
      `INSERT INTO usuarios (email, pin, verification_code, is_verified) 
       VALUES (?, ?, ?, 0)
       ON CONFLICT(email) DO UPDATE SET pin=?, verification_code=?, is_verified=0`,
      [email, pin, verificationCode, pin, verificationCode],
    );

    if (resend && process.env.RESEND_API_KEY) {
      await resend.emails.send({
        from: "Vigilante Digital <onboarding@resend.dev>",
        to: email,
        subject: "🔑 Activa tu Escudo - Código de Verificación",
        html: `
          <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
            <h2>¡Bienvenido a Vigilante Digital AI!</h2>
            <p>Ingresa el siguiente código en tu extensión para activar tu cuenta:</p>
            <div style="background: #f1f5f9; padding: 15px; font-size: 26px; font-weight: bold; letter-spacing: 4px; text-align: center; border-radius: 8px; margin: 20px 0; color: #0284c7;">
              ${verificationCode}
            </div>
          </div>
        `,
      });
    } else {
      console.log(`\n======================================================`);
      console.log(
        `✉️ [BD + SIMULADOR GMAIL] Código para ${email}: ${verificationCode}`,
      );
      console.log(`======================================================\n`);
    }

    res.json({ success: true, message: "Código enviado y registrado en BD." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error registrando en la base de datos." });
  }
});

// 🔑 2. ENDPOINT: VERIFICACIÓN OTP (Modifica la BD)
app.post("/api/auth/verify", async (req, res) => {
  const { email, code } = req.body;

  try {
    // Buscamos el usuario en la BD
    const usuario = await db.get("SELECT * FROM usuarios WHERE email = ?", [
      email,
    ]);

    if (!usuario || usuario.verification_code !== code) {
      return res
        .status(400)
        .json({ success: false, error: "Código incorrecto o expirado." });
    }

    // Actualizamos el estado del usuario a verificado en la BD
    await db.run(
      "UPDATE usuarios SET is_verified = 1, verification_code = NULL WHERE email = ?",
      [email],
    );

    console.log(`🔓 Usuario activado en BD con éxito: ${email}`);
    res.json({ success: true, message: "Cuenta verificada en base de datos." });
  } catch (error) {
    res.status(500).json({ error: "Error verificando en la base de datos." });
  }
});

// 🕵️‍♂️ 3. ENDPOINT: ANALIZADOR DE PHISHING (GEMINI)
app.post("/api/analyze", async (req, res) => {
  const { textContent, currentUrl } = req.body;

  if (!textContent || !currentUrl) {
    return res.status(400).json({ error: "Faltan parámetros de escaneo." });
  }

  if (!ai || !process.env.GEMINI_API_KEY) {
    return res.json({
      isThreat: false,
      score: 0,
      threatType: "",
      reason: "Modo simulación activo.",
    });
  }

  try {
    const prompt = `Actúas como un motor forense de ciberseguridad. Analiza de forma cruzada si la URL y el texto presentan phishing, ingeniería social o fraudes Ponzi.
    URL actual: ${currentUrl}
    Texto: "${textContent}"`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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

    res.json(JSON.parse(response.text));
  } catch (error) {
    res.status(500).json({ error: "Error en el análisis de IA." });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 Servidor con Base de Datos corriendo en puerto ${PORT}`),
);
