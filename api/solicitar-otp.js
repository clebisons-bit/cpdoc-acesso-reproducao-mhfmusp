import crypto from 'crypto';

global.otpStore = global.otpStore || new Map();

function mascararEmail(email) {
  if (!email || !email.includes('@')) return 'e-mail cadastrado';
  const [user, domain] = email.split('@');
  if (user.length <= 2) {
    return `${user[0]}*@${domain}`;
  }
  return `${user[0]}${'*'.repeat(Math.min(user.length - 2, 5))}${user.slice(-1)}@${domain}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Utilize POST.' });
  }

  const { cpf } = req.body || {};
  const cpfLimpo = String(cpf || '').replace(/\D/g, '');

  if (!cpfLimpo || cpfLimpo.length !== 11) {
    return res.status(400).json({ error: 'Número de CPF inválido. Forneça 11 dígitos numéricos.' });
  }

  try {
    const basePesquisadores = [
      {
        cpf: "12345678900",
        nome: "Pesquisador Teste USP",
        email: "clebison.s@fm.usp.br",
        telefone: "(11) 98765-4321",
        instituicao: "Faculdade de Medicina da USP",
        vinculo: "Pós-Graduando"
      }
    ];

    const pesquisador = basePesquisadores.find(p => p.cpf === cpfLimpo);

    if (!pesquisador) {
      return res.status(404).json({
        localizado: false,
        message: 'CPF não localizado na base prévia. Por favor, prossiga com o preenchimento manual.'
      });
    }

    const codigoOTP = crypto.randomInt(100000, 999999).toString();
    const tempoExpiracao = Date.now() + 10 * 60 * 1000;

    global.otpStore.set(cpfLimpo, {
      codigo: codigoOTP,
      expiresAt: tempoExpiracao,
      tentativas: 0,
      dados: pesquisador
    });

    const brevoApiKey = process.env.BREVO_API_KEY;
    if (!brevoApiKey) {
      console.error('Variável BREVO_API_KEY não configurada na Vercel.');
      return res.status(500).json({ error: 'Configuração do serviço de e-mail pendente no servidor.' });
    }

    // Disparo do código temporário por e-mail via Brevo
    const respostaBrevo = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': brevoApiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { 
          name: "CPDoc - Museu Histórico FMUSP", 
          email: "propostacpdoc@gmail.com" // E-mail verificado no Brevo
        },
        to: [
          { 
            email: pesquisador.email, 
            name: pesquisador.nome 
          }
        ],
        subject: "Código de Verificação de Cadastro - CPDoc MHFMUSP",
        htmlContent: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
            <h2 style="color: #0b3b60; margin-top: 0;">Identificação de Cadastro Prévia</h2>
            <p>Olá, <strong>${pesquisador.nome}</strong>.</p>
            <p>Recebemos uma solicitação de identificação para acesso ao acervo do CPDoc utilizando o seu CPF.</p>
            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; text-align: center; margin: 25px 0;">
              <span style="font-size: 13px; color: #4b5563; text-transform: uppercase; letter-spacing: 1px;">O seu código de verificação é:</span>
              <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0b3b60; margin-top: 8px;">${codigoOTP}</div>
            </div>
            <p style="font-size: 14px; color: #4b5563;">Este código é válido por <strong>10 minutos</strong>. Após a confirmação, os seus dados serão preenchidos automaticamente e os uploads de identificação serão dispensados.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            <p style="font-size: 12px; color: #9ca3af; margin-bottom: 0;">Se não solicitou esta ação, ignore este e-mail.</p>
          </div>
        `
      })
    });

    if (!respostaBrevo.ok) {
      const detalheErro = await respostaBrevo.text();
      console.error('Erro no envio do e-mail OTP pelo Brevo:', detalheErro);
      throw new Error('Falha na comunicação com o serviço Brevo.');
    }

    return res.status(200).json({
      localizado: true,
      emailMascarado: mascararEmail(pesquisador.email)
    });

  } catch (erro) {
    console.error('Erro na rota solicitar-otp:', erro);
    return res.status(500).json({ error: 'Erro interno ao processar a validação do cadastro.' });
  }
}
