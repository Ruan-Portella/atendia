/** Esqueleto do editor do chatbot (mesma grade da página: abas, conteúdo, teste ao vivo). */
export default function BotEditorLoading() {
  return (
    <div aria-busy="true" aria-label="Carregando" className="-mx-4 -my-5 flex min-h-full flex-col sm:-mx-6 sm:-my-7 lg:-mx-9">
      <div className="flex items-center gap-3 border-b border-line bg-panel px-4 py-3.5 sm:px-5 md:px-7">
        <div className="skeleton h-4 w-20" />
        <div className="skeleton h-7 w-7 rounded-full" />
        <div className="skeleton h-5 w-48" />
      </div>
      <div className="grid flex-1 lg:grid-cols-[200px_minmax(0,1fr)_360px] xl:grid-cols-[220px_minmax(0,1fr)_400px]">
        <div className="flex gap-2 border-b border-line p-3 lg:flex-col lg:border-b-0 lg:border-r lg:p-3.5">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-9 w-28 shrink-0 lg:w-full" />)}
        </div>
        <div className="flex flex-col gap-4 px-4 py-5 sm:px-5 md:px-7 md:py-6">
          <div className="skeleton h-7 w-56" />
          <div className="skeleton h-4 w-80 max-w-full" />
          <div className="skeleton mt-2 h-40 w-full rounded-xl" />
        </div>
        <div className="hidden border-l border-line bg-[#ecebe4] p-5 lg:block">
          <div className="skeleton h-[560px] w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
