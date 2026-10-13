import { DESTINO, chaveCpf, cpfValido, enviarBrevo, esc, ipDe, lerBody, lerSessao, limitar, redis } from './_lib.js';

const EXT_PERMITIDAS = /\.(pdf|jpe?g|png)$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const texto = (v, max) => String(v ?? '').trim().slice(0, max);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido. Utilize POST.' });

  try {
    if (!(await limitar(`send:ip:${ipDe(req)}`, 10, 3600))) {
      return res.status(429).json({ error: 'Muitos envios em pouco tempo. Aguarde e tente novamente.' });
    }

    const b = lerBody(req);

    const resumo = (Array.isArray(b.resumo) ? b.resumo : [])
      .filter((l) => Array.isArray(l) && l.length >= 2)
      .map(([k, v]) => [texto(k, 200), texto(v, 8000)]);
    if (!resumo.length) return res.status(400).json({ error: 'Dados da solicitação ausentes.' });

    const protocolo = texto(b.protocolo, 60).replace(/[^A-Za-z0-9._-]/g, '') || `REQ-${Date.now()}`;
    const hashDossie = texto(b.hashDossie, 100);
    const tipoDocumento = b.tipoDocumento === 'Passaporte' ? 'Passaporte' : 'CPF';
    const documento = texto(b.documentoNumero, 30);
    const cpfLimpo = documento.replace(/\D/g, '');
    const telefone = texto(b.solicitanteTelefone, 30);
    const instituicao = texto(b.instituicao, 200);
    const vinculo = texto(b.vinculo, 100);

    let nome = texto(b.solicitanteNome, 200);
    let email = texto(b.solicitanteEmail, 200);
    let chave = null;      // chave do cadastro no Redis (só para CPF)
    let cadastro = null;   // cadastro prévio, quando confirmado por OTP
    let confirmadoPorOtp = false;

    /* ---------- Identificação ---------- */
    if (b.sessao) {
      const s = lerSessao(b.sessao);
      if (!s || chaveCpf(cpfLimpo) !== s.k) {
        return res.status(401).json({ error: 'Sua confirmação por código expirou. Confirme o CPF novamente na Etapa 1.', code: 'SESSAO_EXPIRADA' });
      }
      cadastro = JSON.parse((await redis('GET', `pesq:${s.k}`)) || 'null');
      if (!cadastro) {
        return res.status(401).json({ error: 'Cadastro prévio não encontrado. Preencha a Etapa 1 e anexe o documento de identificação.', code: 'SESSAO_EXPIRADA' });
      }
      confirmadoPorOtp = true;
      chave = s.k;
      nome = cadastro.nome;   // vem do cadastro, não do navegador
      email = cadastro.email;
    } else {
      if (!nome) return res.status(400).json({ error: 'Informe o nome completo.' });
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'E-mail inválido.' });
      if (!documento) return res.status(400).json({ error: 'Informe o documento de identificação.' });
      if (tipoDocumento === 'CPF') {
        if (!cpfValido(cpfLimpo)) return res.status(400).json({ error: 'CPF inválido.' });
        chave = chaveCpf(cpfLimpo);
      }
    }

    /* ---------- Anexos ---------- */
    const anexos = [];
    const termo = String(b.pdfBase64 || '').replace(/^data:[^,]*,/, '').replace(/\s/g, '');
    if (termo) anexos.push({ name: `Termo_Acesso_CPDoc_${protocolo}.pdf`, content: termo });

    for (const a of (Array.isArray(b.anexos) ? b.anexos : []).slice(0, 6)) {
      const nomeArq = String(a?.filename || '').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
      const conteudo = String(a?.base64 || '').replace(/^data:[^,]*,/, '').replace(/\s/g, '');
      if (!EXT_PERMITIDAS.test(nomeArq) || !/^[A-Za-z0-9+/]+=*$/.test(conteudo)) continue;
      anexos.push({ name: nomeArq, content: conteudo });
    }

    if (!confirmadoPorOtp && !anexos.some((a) => a.name.startsWith('Identificacao_'))) {
      return res.status(400).json({ error: 'Anexe o documento de identificação com foto.' });
    }

    /* ---------- E-mail para o CPDoc ---------- */
    const dataEnvio = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const situacao = confirmadoPorOtp
      ? `Pesquisador com cadastro prévio. Titularidade do CPF confirmada por código enviado ao e-mail cadastrado. Documento de identificação arquivado no primeiro atendimento.`
      : `Primeiro atendimento deste solicitante. Documento de identificação anexado a este e-mail.`;

    const linhas = resumo
      .map(([k, v]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-weight:bold;vertical-align:top;width:34%">${esc(k)}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${esc(v).replace(/\n/g, '<br>')}</td></tr>`)
      .join('');

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937; max-width: 720px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
        <div style="border-bottom: 2px solid #0b3b60; padding-bottom: 12px; margin-bottom: 20px;">
          <h2 style="color: #0b3b60; margin: 0;">Solicitação de Acesso e Reprodução de Acervo</h2>
          <small style="color: #6b7280;">Museu Histórico "Prof. Carlos da Silva Lacaz" — FMUSP</small>
        </div>
        <div style="background-color: #f3f4f6; padding: 12px 16px; border-left: 4px solid #0b3b60; margin-bottom: 20px;">
          <strong>Protocolo:</strong> ${esc(protocolo)}<br>
          <strong>Data de envio:</strong> ${esc(dataEnvio)}<br>
          <strong>Identificação:</strong> ${esc(situacao)}<br>
          ${hashDossie ? `<strong>SHA-256 do dossiê:</strong> <code style="font-size: 11px; word-break: break-all;">${esc(hashDossie)}</code>` : ''}
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:14px">${linhas}</table>
        <p style="font-size: 13px; color: #6b7280; margin-top: 20px;">
          O termo de compromisso e os documentos seguem em anexo. Para responder, use "Responder": a mensagem vai para ${esc(email)}.
        </p>
      </div>`;

    await enviarBrevo({
      to: [{ email: DESTINO(), name: 'CPDoc / Atendimento ao Investigador' }],
      // Cópia ao solicitante só quando o e-mail foi comprovado pelo OTP (evita uso do formulário para enviar e-mail a terceiros)
      ...(confirmadoPorOtp ? { cc: [{ email, name: nome }] } : {}),
      replyTo: { email, name: nome },
      subject: `[CPDoc MHFMUSP] Solicitação de Acesso ao Acervo - ${protocolo} - ${nome}`,
      htmlContent,
      attachment: anexos.length ? anexos : undefined
    });

    /* ---------- Cadastro para os próximos acessos (falha aqui não invalida o envio) ---------- */
    try {
      if (chave) {
        const agora = new Date().toISOString();
        if (confirmadoPorOtp) {
          await redis('SET', `pesq:${chave}`, JSON.stringify({ ...cadastro, telefone: telefone || cadastro.telefone, ultimoUso: agora }));
        } else {
          // NX: nunca sobrescreve um cadastro existente
          await redis('SET', `pesq:${chave}`, JSON.stringify({ nome, email, telefone, instituicao, vinculo, criadoEm: agora, ultimoUso: agora }), 'NX');
        }
      }
    } catch (e) {
      console.error('Envio concluído, mas o cadastro não foi gravado:', e.message);
    }

    return res.status(200).json({ sucesso: true, protocolo });
  } catch (erro) {
    console.error('Erro na rota send-email:', erro);
    if (erro.status) return res.status(502).json({ error: 'O serviço de e-mail recusou o envio. Tente novamente em instantes.', code: `BREVO_${erro.status}` });
    return res.status(500).json({ error: 'Erro interno ao processar a solicitação.' });
  }
}
