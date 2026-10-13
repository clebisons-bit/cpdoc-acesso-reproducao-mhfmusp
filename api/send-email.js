export default async function handler(req, res) {
  // 1. Cabeçalhos CORS para permitir requisições do front-end
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

  try {
    // Normalização do corpo da requisição (trata objeto direto ou string JSON)
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        // Mantém como está se a conversão falhar
      }
    }

    // Suporte a dados diretos ou encapsulados em "dados", "formData" ou "form"
    const data = body?.dados || body?.formData || body?.form || body || {};

    // Extração flexível dos campos para evitar incompatibilidades de nomes
    const nome = (
      data.nome ||
      data.nomeCompleto ||
      data.nome_completo ||
      data.solicitante_nome ||
      data.nome_solicitante ||
      data['nome-completo'] ||
      ''
    ).trim();

    const cpf = (
      data.cpf ||
      data.cpfSolicitante ||
      data.cpf_solicitante ||
      data.solicitante_cpf ||
      data.documento_cpf ||
      data['cpf'] ||
      ''
    ).trim();

    const email = (
      data.email ||
      data.emailContato ||
      data.email_contato ||
      data.solicitante_email ||
      data.email_solicitante ||
      data['email'] ||
      ''
    ).trim();

    const telefone = data.telefone || data.tel || data.telefone_contato || data.celular || '';
    const instituicao = data.instituicao || data.instituicao_vinculo || data.universidade || '';
    const vinculo = data.vinculo || data.tipo_vinculo || data.cargo || '';
    const finalidade = data.finalidade || data.tipo_finalidade || data.tipoPesquisa || '';
    const descricaoProjeto = data.descricaoProjeto || data.descricao_projeto || data.justificativa || data.projeto || '';
    const itensSolicitados = data.itensSolicitados || data.itens_solicitados || data.lista_itens || data.itens || '';
    const protocolo = data.protocolo || data.codigoAcompanhamento || data.codigo_acompanhamento || `REQ-${Date.now()}`;
    const hashDossie = data.hashDossie || data.hash_dossie || data.sha256 || '';
    const validacaoOtpTimestamp = data.validacaoOtpTimestamp || data.validacao_otp_timestamp || '';
    const pdfBase64 = data.pdfBase64 || data.pdf_base64 || data.pdf || data.arquivo_pdf || '';

    // Validação dos dados essenciais
    if (!nome || !email || !cpf) {
      console.error('Campos obrigatórios em falta. Chaves detetadas no envio:', Object.keys(data));
      return res.status(400).json({
        error: 'Dados obrigatórios em falta (nome, e-mail ou CPF).',
        chavesRecebidas: Object.keys(data)
      });
    }

    const brevoApiKey = process.env.BREVO_API_KEY;
    if (!brevoApiKey) {
      console.error('Variável BREVO_API_KEY não configurada na Vercel.');
      return res.status(500).json({ error: 'Configuração do serviço de e-mail pendente no servidor.' });
    }

    const dataEnvioFormatada = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    // Preparação do anexo PDF em Base64 (se fornecido)
    const attachments = [];
    if (pdfBase64) {
      const base64Limpo = String(pdfBase64).replace(/^data:application\/pdf;base64,/, '').trim();
      if (base64Limpo.length > 0) {
        attachments.push({
          name: `Termo_Acesso_CPDoc_${protocolo}.pdf`,
          content: base64Limpo
        });
      }
    }

    // Montagem do corpo de e-mail estruturado
    const htmlEmail = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 680px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
        <div style="border-bottom: 2px solid #0b3b60; padding-bottom: 12px; margin-bottom: 20px;">
          <h2 style="color: #0b3b60; margin: 0;">Solicitação de Acesso e Reprodução de Acervo</h2>
          <small style="color: #6b7280;">Museu Histórico "Prof. Carlos da Silva Lacaz" — FMUSP</small>
        </div>

        <p>Foi submetida uma nova solicitação formal de consulta/reprodução com o seguinte protocolo:</p>
        
        <div style="background-color: #f3f4f6; padding: 12px 16px; border-left: 4px solid #0b3b60; margin-bottom: 20px;">
          <strong>Protocolo / Identificador:</strong> ${protocolo}<br>
          <strong>Data de Envio:</strong> ${dataEnvioFormatada}<br>
          ${validacaoOtpTimestamp ? `<strong>Autenticação 2FA (OTP):</strong> Validada em ${validacaoOtpTimestamp}<br>` : ''}
          ${hashDossie ? `<strong>Assinatura Digital (SHA-256):</strong> <code style="font-size: 11px; word-break: break-all;">${hashDossie}</code>` : ''}
        </div>

        <h3 style="color: #0b3b60; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px;">1. Dados do Solicitante</h3>
        <ul style="list-style: none; padding-left: 0; line-height: 1.8;">
          <li><strong>Nome Completo:</strong> ${nome}</li>
          <li><strong>CPF:</strong> ${cpf}</li>
          <li><strong>E-mail:</strong> ${email}</li>
          <li><strong>Telefone:</strong> ${telefone || 'Não informado'}</li>
          <li><strong>Instituição:</strong> ${instituicao || 'Não informada'}</li>
          <li><strong>Vínculo:</strong> ${vinculo || 'Não informado'}</li>
        </ul>

        <h3 style="color: #0b3b60; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px;">2. Finalidade e Justificativa</h3>
        <p><strong>Tipo de Solicitação:</strong> ${finalidade || 'Não informada'}</p>
        <p><strong>Descrição do Projeto / Justificativa:</strong></p>
        <div style="background-color: #f9fafb; padding: 10px; border: 1px solid #e5e7eb; border-radius: 4px; font-style: italic;">
          ${descricaoProjeto ? String(descricaoProjeto).replace(/\n/g, '<br>') : 'Não detalhado'}
        </div>

        <h3 style="color: #0b3b60; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px;">3. Itens do Acervo Pretendidos</h3>
        <div style="background-color: #f9fafb; padding: 10px; border: 1px solid #e5e7eb; border-radius: 4px;">
          ${itensSolicitados ? String(itensSolicitados).replace(/\n/g, '<br>') : 'Consultar PDF em anexo.'}
        </div>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 25px 0;">
        <p style="font-size: 13px; color: #6b7280;">
          O termo formal de compromisso assinado encontra-se no documento PDF anexo a esta mensagem. O prazo regular para análise técnica e resposta do CPDoc é de até 10 dias úteis.
        </p>
      </div>
    `;

    // Disparo através da API do Brevo com o remetente verificado
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
          email: "clebison.s@fm.usp.br" // Remetente verificado no Brevo
        },
        to: [
          {
            email: "museu.historico@fm.usp.br",
            name: "CPDoc / Atendimento ao Investigador"
          }
        ],
        cc: [
          {
            email: email,
            name: nome
          }
        ],
        replyTo: {
          email: email,
          name: nome
        },
        subject: `[CPDoc MHFMUSP] Solicitação de Acesso ao Acervo - ${protocolo} - ${nome}`,
        htmlContent: htmlEmail,
        attachment: attachments.length > 0 ? attachments : undefined
      })
    });

    if (!respostaBrevo.ok) {
      const detalheErro = await respostaBrevo.text();
      console.error('Erro na resposta do Brevo:', detalheErro);
      return res.status(respostaBrevo.status).json({
        error: 'Falha no envio do e-mail através do Brevo.',
        detalhes: detalheErro
      });
    }

    const resultadoBrevo = await respostaBrevo.json();

    return res.status(200).json({
      sucesso: true,
      protocolo: protocolo,
      messageId: resultadoBrevo.messageId
    });

  } catch (erro) {
    console.error('Erro interno na função send-email:', erro);
    return res.status(500).json({ error: 'Erro interno ao processar e expedir a solicitação.' });
  }
}
