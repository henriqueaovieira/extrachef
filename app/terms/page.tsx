import Link from 'next/link';

export default function TermsPage() {
  return <main className="mx-auto min-h-dvh max-w-3xl space-y-6 px-5 py-8 text-gray-800">
    <h1 className="text-2xl font-bold">Termos de uso do ExtraChef</h1>
    <p className="text-sm text-gray-500">Versão 2026-10-15. Documento-base do Beta sujeito à revisão jurídica e identificação do operador antes do lançamento externo.</p>
    <section className="space-y-2"><h2 className="text-lg font-semibold">Uso do serviço</h2><p>ExtraChef conecta restaurantes e profissionais por vagas, candidaturas, mensagens, presença e avaliações. Cada participante deve fornecer informações verdadeiras, cumprir os combinados e manter sua conta protegida. O MVP não processa pagamentos nem garante contratação, identidade verificada ou disponibilidade de vagas.</p></section>
    <section className="space-y-2"><h2 className="text-lg font-semibold">Conduta e registros</h2><p>Não publique conteúdo abusivo, documentos de terceiros sem autorização ou dados fraudulentos. Avaliações devem se referir a diárias concluídas. A emissão do código de check-in usa a localização pontual informada pelo dispositivo para validar o raio de 100 metros do local da operação; não é uma garantia contra falsificação de GPS. Não há rastreamento contínuo, monitoramento em segundo plano ou validação GPS no check-out.</p></section>
    <section className="space-y-2"><h2 className="text-lg font-semibold">Beta, suporte e encerramento</h2><p>O Beta pode apresentar falhas. Questões operacionais, responsabilidades das partes e condições de contratação devem ser acordadas antes da diária. A conta pode ser encerrada nas configurações após resolver serviços ativos. O operador deve fornecer canal de suporte, regras de moderação e procedimento para contestação antes do uso externo.</p></section>
    <Link href="/privacy" className="inline-flex min-h-12 items-center font-semibold text-orange-700 underline">Política de privacidade</Link>
    <Link href="/settings/privacy" className="ml-4 inline-flex min-h-12 items-center underline">Configurações</Link>
  </main>;
}