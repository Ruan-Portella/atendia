-- O nome da identificação ficava na ficha depois de desfeito o último vínculo (23/10/2026). No
-- WhatsApp e no Instagram, o display só vem do vínculo ativo: sem vínculo, sai, e o painel volta ao
-- nome do perfil. No chat do site, o display vem do token da empresa e fica.
update public.contacts set display = null
where channel <> 'widget' and active_link_id is null and display is not null;
