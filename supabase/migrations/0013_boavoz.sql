-- Boavoz · a plataforma trocou de nome (antes Atendia): a agência vitrine acompanha
-- Idempotente. A vitrine é dona das demos anônimas da landing; o nome dela aparece na demo.
update public.agencies
set name = 'Boavoz', slug = 'boavoz'
where slug = 'atendia'
  and not exists (select 1 from public.agencies where slug = 'boavoz');
