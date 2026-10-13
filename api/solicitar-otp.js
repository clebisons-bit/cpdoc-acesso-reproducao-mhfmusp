import crypto from 'crypto';
import { chaveCpf, cpfValido, enviarBrevo, esc, ipDe, lerBody, limitar, mascararEmail, hmac, redis } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido. Utilize POST.' });

  const cpfLimpo = String(lerBody(req).cpf || '').replace(/\D/g, '');
  if (!cpfValido(cpfLimpo)) return res.status(400).json({ error: 'CPF inválido. Confira os 11 dígitos.' });

  try {
    if (!(await limitar(`otp:ip:${ipDe(req)}`, 10, 3600))) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde um pouco e tente novamente.' });
    }

    const k = chaveCpf(cpfLimpo);
    const bruto = await redis('GET', `pesq:${k}`);
    if (!bruto) return res.status(200).json({ localizado: false });
    const pesquisador = JSON.parse(bruto);

    // Intervalo mínimo entre envios e teto por CPF
    const livre = await redis('SET', `otpcd:${k}`, 1, 'EX', 60, 'NX');
    if (!livre) return res.status(429).json({ error: 'Um código acabou de ser enviado. Aguarde 1 minuto para pedir outro.' });
    if (!(await limitar(`otp:cpf:${k}`, 5, 3600))) {
      return res.status(429).json({ error: 'Limite de códigos por hora atingido para este CPF. Tente mais tarde.' });
    }

    const codigo = crypto.randomInt(100000, 1000000).toString();
    await redis('SET', `otp:${k}`, JSON.stringify({ h: hmac(`otp:${k}:${codigo}`) }), 'EX', 600);
    await redis('SET', `otpt:${k}`, 0, 'EX', 600);

    try {
      await enviarBrevo({
        to: [{ email: pesquisador.email, name: pesquisador.nome }],
        subject: 'Código de verificação - CPDoc MHFMUSP',
        htmlContent: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
            <h2 style="color: #0b3b60; margin-top: 0;">Confirmação de identidade</h2>
            <p>Olá, <strong>${esc(pesquisador.nome)}</strong>.</p>
            <p>Recebemos um pedido para reutilizar o seu cadastro prévio no formulário de acesso ao acervo do CPDoc.</p>
            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; text-align: center; margin: 25px 0;">
              <span style="font-size: 13px; color: #4b5563; text-transform: uppercase; letter-spacing: 1px;">Seu código de verificação</span>
              <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0b3b60; margin-top: 8px;">${codigo}</div>
            </div>
            <p style="font-size: 14px; color: #4b5563;">O código vale por <strong>10 minutos</strong>. Depois de confirmado, seus dados serão preenchidos e o documento de identificação não precisará ser enviado de novo.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            <p style="font-size: 12px; color: #9ca3af; margin-bottom: 0;">Se não foi você, ignore este e-mail. Ninguém terá acesso ao seu cadastro sem este código.</p>
          </div>`
      });
    } catch (e) {
      await redis('DEL', `otp:${k}`);
      await redis('DEL', `otpt:${k}`);
      console.error('Falha ao enviar OTP pelo Brevo:', e.message);
      return res.status(502).json({ error: 'Não foi possível enviar o e-mail com o código agora. Tente novamente em instantes.' });
    }

    return res.status(200).json({ localizado: true, emailMascarado: mascararEmail(pesquisador.email) });
  } catch (erro) {
    console.error('Erro na rota solicitar-otp:', erro);
    return res.status(500).json({ error: 'Erro interno ao processar a verificação.' });
  }
}
