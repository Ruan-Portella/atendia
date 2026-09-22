/** Esqueleto mostrado na hora ao navegar entre páginas do painel, enquanto os dados chegam. */
export default function PainelLoading() {
  return (
    <div aria-busy="true" aria-label="Carregando" className="flex flex-col gap-5 md:gap-6">
      <div className="flex flex-col gap-2">
        <div className="skeleton h-8 w-48" />
        <div className="skeleton h-4 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-3.5 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card flex flex-col gap-2.5 px-4 py-4">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-7 w-16" />
            <div className="skeleton h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="card overflow-hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line-2 px-4 py-4 last:border-0">
            <div className="skeleton h-[30px] w-[30px] rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="skeleton h-3.5 w-40 max-w-full" />
              <div className="skeleton h-3 w-24" />
            </div>
            <div className="skeleton hidden h-3.5 w-20 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
