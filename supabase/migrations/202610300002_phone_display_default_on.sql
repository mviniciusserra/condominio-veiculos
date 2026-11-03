-- Troca o padrão de exibição do telefone para habilitado. Moradores continuam
-- podendo desativar em "Meu perfil" a qualquer momento.
alter table public.profiles alter column show_phone set default true;

-- Aplica o novo padrão aos perfis já existentes. Seguro neste momento porque o
-- recurso acabou de ser lançado (nenhum morador usou a tela de perfil ainda para
-- desativar essa opção deliberadamente).
update public.profiles set show_phone = true where show_phone = false;
