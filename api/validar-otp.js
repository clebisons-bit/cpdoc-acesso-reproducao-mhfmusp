export default async function handler(req, res) {
  // Cabeçalhos CORS
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

  const { cpf, codigo } = req.body || {};
  const cpfLimpo = String(cpf || '').replace(/\D/g, '');
  const codigoLimpo = String(codigo || '').trim();

  const registro = global.otpStore ? global.otpStore.get(cpfLimpo) : null;

  if (!registro) {
    return res.status(400).json({ error: 'Nenhum código pendente para este CPF. Solicite um novo código.' });
  }

  // Verifica tempo de expiração (10 minutos)
  if (Date.now() > registro.expiresAt) {
    global.otpStore.delete(cpfLimpo);
    return res.status(400).json({ error: 'O código expirou. Solicite um novo envio.' });
  }

  // Bloqueio após 3 tentativas inválidas
  if (registro.tentativas >= 3) {
    global.otpStore.delete(cpfLimpo);
    return res.status(429).json({ error: 'Número de tentativas excedido. Solicite um novo código.' });
  }

  if (registro.codigo !== codigoLimpo) {
    registro.tentativas += 1;
    return res.status(400).json({ error: 'Código incorreto. Tente novamente.' });
  }

  // Código correto: obtém os dados e destrói o token para uso único
  const dadosPesquisador = registro.dados;
  global.otpStore.delete(cpfLimpo);

  return res.status(200).json({
    autenticado: true,
    pesquisador: {
      nome: dadosPesquisador.nome,
      email: dadosPesquisador.email,
      telefone: dadosPesquisador.telefone,
      instituicao: dadosPesquisador.instituicao,
      vinculo: dadosPesquisador.vinculo,
      cadastroValidado: true,
      timestampValidacao: new Date().toISOString()
    }
  });
}
