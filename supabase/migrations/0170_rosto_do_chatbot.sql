-- Rosto do chatbot (redesenho, etapa 3; 22/10/2026): os olhos e o acessório do ícone do chatbot
-- ({eyes, acc}, as opções em lib/bot-face.ts). A cor é a cor principal (appearance.color). Fica
-- fora do appearance para o chatbot derivado de um modelo ter o rosto dele, sem mexer na herança da
-- aparência. Sem rosto, o painel mostra o padrão e o chat do site mostra as iniciais. Idempotente.
alter table public.bots add column if not exists face jsonb;

notify pgrst, 'reload schema';
