import { chaveCpf, criarSessao, cpfValido, hmac, iguais, ipDe, lerBody, limitar, redis } from './_lib.js';

const MAX_TENTATIVAS = 5;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido. Utilize POST.' });

  const body = lerBody(req);
  const cpfLimpo = String(body.cpf || '').replace(/\D/g, '');
  const codigo = String(body.codigo || '').replace(/\D/g, '');
  if (!cpfValido(cpfLimpo) || codigo.length !== 6) {
    return res.status(400).json({ error: 'Informe o CPF e o código de 6 dígitos.' });
  }

  try {
    if (!(await limitar(`val:ip:${ipDe(req)}`, 30, 3600))) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde um pouco e tente novamente.' });
    }

    const k = chaveCpf(cpfLimpo);
    const bruto = await redis('GET', `otp:${k}`);
    if (!bruto) return res.status(400).json({ error: 'Nenhum código válido para este CPF. Solicite um novo código.' });

    const tentativa = Number(await redis('INCR', `otpt:${k}`));
    if (tentativa > MAX_TENTATIVAS) {
      await redis('DEL', `otp:${k}`);
      await redis('DEL', `otpt:${k}`);
      return res.status(429).json({ error: 'Número de tentativas excedido. Solicite um novo código.' });
    }

    if (!iguais(JSON.parse(bruto).h, hmac(`otp:${k}:${codigo}`))) {
      const restam = MAX_TENTATIVAS - tentativa;
      return res.status(400).json({ error: `Código incorreto. ${restam > 0 ? `Restam ${restam} tentativa(s).` : 'Solicite um novo código.'}` });
    }

    // Código correto: uso único
    await redis('DEL', `otp:${k}`);
    await redis('DEL', `otpt:${k}`);

    const pesquisador = JSON.parse((await redis('GET', `pesq:${k}`)) || 'null');
    if (!pesquisador) return res.status(400).json({ error: 'Cadastro não encontrado. Preencha o formulário normalmente.' });

    const sessao = criarSessao(k);
    return res.status(200).json({
      autenticado: true,
      sessao: sessao.token,
      expiraEm: sessao.exp,
      pesquisador: {
        nome: pesquisador.nome,
        email: pesquisador.email,
        telefone: pesquisador.telefone || '',
        instituicao: pesquisador.instituicao || '',
        vinculo: pesquisador.vinculo || '',
        timestampValidacao: new Date().toISOString()
      }
    });
  } catch (erro) {
    console.error('Erro na rota validar-otp:', erro);
    return res.status(500).json({ error: 'Erro interno ao validar o código.' });
  }
}
