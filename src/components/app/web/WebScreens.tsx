"use client";

import { useMemo, useState, type ReactNode } from "react";
import { groupShort, packGroups, type Pack, type PackGroup } from "@/lib/catalog";
import { setSettings, useNotes, useSettings } from "@/lib/store";
import { fold } from "@/lib/text";
import { Cover } from "@/components/ui/Cover";
import { Icon } from "@/components/ui/Icon";
import { Btn, Card, Chip, cx, Dots, Empty, Group, H1, Lbl, Pick, SearchField, Seg, Switch } from "@/components/ui/kit";
import { qualityOptions, sizeOptions, startOptions } from "../mobile/MobileScreens";
import type { AppNav } from "../nav";
import { AboutContent, NoteCard, useContinue, usePackProgress } from "../shared";

/** Scrolling main area beside the sidebar. */
function Main({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main className="min-w-0 flex-1 overflow-y-auto">
      <div className={cx("mx-auto flex max-w-[1280px] flex-col gap-[30px] px-11 py-9", className)}>{children}</div>
    </main>
  );
}

function PackCard({ pack, group, onOpen, summary = false }: { pack: Pack; group: PackGroup; onOpen: () => void; summary?: boolean }) {
  const progress = usePackProgress(pack.id);
  return (
    <button type="button" onClick={onOpen} className="group min-w-0 text-left">
      <div className="relative">
        <Cover packId={pack.id} groupId={group.id} className="h-[124px] w-full transition-opacity group-hover:opacity-90" rounded="rounded-2xl" label={pack.title} />
        {progress.count > 0 && (
          <Chip tone="ink" size="s" className="absolute left-2.5 top-2.5">
            {progress.count}/{progress.total}
          </Chip>
        )}
      </div>
      <div className="mt-2.5 text-[15.5px] font-semibold leading-snug">{pack.title}</div>
      <div className="mt-0.5 text-[13px] text-muted">{pack.views.length} vistas</div>
      {summary && <div className="mt-1 line-clamp-2 text-[13px] leading-snug text-ink-2">{pack.summary}</div>}
    </button>
  );
}

function GroupPicks({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Pick size="s" on={!value} onClick={() => onChange(null)}>
        Todos
      </Pick>
      {packGroups.map((group) => (
        <Pick key={group.id} size="s" on={value === group.id} onClick={() => onChange(group.id)}>
          {groupShort[group.id] ?? group.title}
        </Pick>
      ))}
    </div>
  );
}

// ---- Início ----------------------------------------------------------------------------------------------

export function WHome({ nav }: { nav: AppNav }) {
  const next = useContinue();
  const [filter, setFilter] = useState<string | null>(null);
  const packs = packGroups.filter((group) => !filter || group.id === filter).flatMap((group) => group.packs.map((pack) => ({ pack, group })));
  return (
    <Main>
      <div className="grid grid-cols-[1.6fr_1fr] gap-5 tight:grid-cols-1">
        <Card padded={false} className="flex overflow-hidden">
          <button type="button" onClick={() => nav.continueLast()} aria-label={`Continuar: ${next.pack.title}`} className="flex shrink-0 self-stretch">
            <Cover packId={next.pack.id} groupId={next.group.id} viewId={next.view.id} className="h-full min-h-[300px] w-[230px]" rounded="rounded-none" />
          </button>
          <div className="flex min-w-0 flex-1 flex-col px-7 py-[26px]">
            <Lbl className="text-rose-deep">{next.fresh ? "Comece por aqui" : "Continue de onde parou"}</Lbl>
            <div className="mt-2 text-[30px] font-semibold leading-tight tracking-[-0.9px]">{next.pack.title}</div>
            <div className="mt-1 text-base text-ink-2">
              Vista {next.index + 1} de {next.pack.views.length} · {next.view.title}
            </div>
            <div className="mt-3.5">
              <Dots count={next.pack.views.length} active={next.index} />
            </div>
            <div className="mt-3.5 text-sm text-muted">{next.meta}</div>
            <div className="flex-1" />
            <div className="mt-4 flex flex-wrap gap-2.5">
              <Btn icon="arrowR" full={false} className="h-12 px-[22px] text-[15px]" onClick={() => nav.continueLast()}>
                {next.fresh ? "Começar" : "Continuar"}
              </Btn>
              <Btn variant="ghost" full={false} leading="present" className="h-12 gap-2 px-[18px] text-[15px]" onClick={() => nav.continueLast(true)}>
                Apresentar
              </Btn>
            </div>
          </div>
        </Card>
        <div className="grid grid-rows-2 gap-5 tight:grid-cols-2 tight:grid-rows-1">
          {[
            { icon: "flow" as const, title: "Modo guiado", text: "Escolha um pack e avance vista a vista, com câmera, rótulos e texto prontos.", link: "Ver packs", run: () => nav.go({ name: "library" }) },
            { icon: "cube" as const, title: "Modo livre", text: "O modelo inteiro aberto: camadas, corte, forma da mama e posição do braço.", link: "Abrir modelo", run: () => nav.openFree() },
          ].map((item) => (
            <Card key={item.title} as="button" onClick={item.run} className="flex gap-4 p-[22px] hover:bg-surface-alt">
              <div className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[14px] bg-rose-tint text-rose-deep">
                <Icon name={item.icon} size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold">{item.title}</div>
                <div className="mt-1 text-sm leading-[1.45] text-ink-2">{item.text}</div>
                <div className="mt-2.5 flex items-center gap-1.5 text-sm font-semibold">
                  {item.link}
                  <Icon name="arrowR" size={15} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
      <section>
        <div className="mb-3.5 flex flex-wrap items-baseline gap-3.5">
          <h2 className="text-[22px] font-semibold tracking-[-0.5px]">Biblioteca</h2>
          <div className="ml-auto">
            <GroupPicks value={filter} onChange={setFilter} />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4 tight:grid-cols-3">
          {packs.map(({ pack, group }) => (
            <PackCard key={pack.id} pack={pack} group={group} onOpen={() => nav.openPack(pack.id)} />
          ))}
        </div>
      </section>
    </Main>
  );
}

// ---- Biblioteca ------------------------------------------------------------------------------------------

export function WLibrary({ nav, group }: { nav: AppNav; group: string | null }) {
  const settings = useSettings();
  const [filter, setFilter] = useState<string | null>(group);
  const [query, setQuery] = useState("");
  const q = fold(query.trim());
  const groups = useMemo(
    () =>
      packGroups
        .filter((item) => !filter || item.id === filter)
        .map((item) => ({ group: item, packs: item.packs.filter((pack) => !q || fold(`${pack.title} ${pack.summary} ${pack.views.map((view) => view.title).join(" ")}`).includes(q)) }))
        .filter((item) => item.packs.length > 0),
    [filter, q],
  );
  const saved = packGroups.flatMap((item) => item.packs.filter((pack) => settings.saved.includes(pack.id)).map((pack) => ({ pack, group: item })));
  return (
    <Main>
      <div className="flex flex-wrap items-end gap-6">
        <H1 sub="Packs de vistas sobre o mesmo modelo: cada vista traz estruturas, câmera, rótulos e texto.">Biblioteca</H1>
        <SearchField value={query} onChange={setQuery} placeholder="Filtrar packs e vistas" className="ml-auto h-12 w-[340px]" />
      </div>
      <GroupPicks value={filter} onChange={setFilter} />
      {saved.length > 0 && !filter && !q && (
        <section>
          <Lbl className="mb-3">Salvos · {saved.length}</Lbl>
          <div className="grid grid-cols-4 gap-4 tight:grid-cols-3">
            {saved.map(({ pack, group: item }) => (
              <PackCard key={pack.id} pack={pack} group={item} summary onOpen={() => nav.openPack(pack.id)} />
            ))}
          </div>
        </section>
      )}
      {groups.length === 0 && <Empty icon="search" title="Nenhum pack encontrado" sub="Tente outro termo ou use a busca (⌘K) para estruturas." />}
      {groups.map(({ group: item, packs }) => (
        <section key={item.id}>
          <div className="mb-3 flex items-baseline gap-3">
            <h2 className="text-lg font-semibold">{item.title}</h2>
            <span className="text-sm text-muted">{item.description}</span>
          </div>
          <div className="grid grid-cols-4 gap-4 tight:grid-cols-3">
            {packs.map((pack) => (
              <PackCard key={pack.id} pack={pack} group={item} summary onOpen={() => nav.openPack(pack.id)} />
            ))}
          </div>
        </section>
      ))}
    </Main>
  );
}

// ---- Anotações -------------------------------------------------------------------------------------------

export function WNotes({ nav }: { nav: AppNav }) {
  const notes = useNotes();
  return (
    <Main>
      <H1 sub="Ficam presas à vista (e ao ponto do modelo) onde foram feitas. Abra uma para voltar a ela.">Anotações</H1>
      {notes.length === 0 ? (
        <Empty icon="pen" title="Nenhuma anotação ainda" sub="No visualizador, use Anotar (ou a tecla A) para prender uma nota a um ponto do modelo.">
          <Btn full={false} className="h-12 px-5 text-[15px]" icon="arrowR" onClick={() => nav.continueLast()}>
            Abrir a última vista
          </Btn>
        </Empty>
      ) : (
        <div className="grid grid-cols-2 gap-3.5 tight:grid-cols-1">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} onOpen={() => nav.openNote(note)} />
          ))}
        </div>
      )}
    </Main>
  );
}

// ---- Ajustes ---------------------------------------------------------------------------------------------

type SettingsSection = "estudo" | "visualizador" | "atalhos" | "sobre";
const sections: { id: SettingsSection; label: string }[] = [
  { id: "estudo", label: "Estudo" },
  { id: "visualizador", label: "Visualizador" },
  { id: "atalhos", label: "Atalhos de teclado" },
  { id: "sobre", label: "Sobre" },
];
export const shortcuts: [string, string][] = [
  ["⌘K / Ctrl K", "Buscar estrutura, vista ou pack"],
  ["← →", "Vista anterior / próxima"],
  ["L", "Mostrar ou ocultar rótulos"],
  ["A", "Nova anotação na vista"],
  ["R", "Centralizar o modelo"],
  ["F", "Foco: esconder os painéis"],
  ["Esc", "Fechar ficha, ferramenta ou modo aula"],
  ["S · P", "Modo aula: laser · caneta"],
];

function SettingLine({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="text-[15.5px] font-semibold">{title}</div>
        {sub && <div className="mt-0.5 text-[13.5px] text-muted">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function WSettings() {
  const settings = useSettings();
  const [section, setSection] = useState<SettingsSection>("estudo");
  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex w-[240px] shrink-0 flex-col gap-1 border-r border-line-soft px-5 py-9">
        <div className="px-3 pb-[18px] text-[26px] font-semibold tracking-[-0.7px]">Ajustes</div>
        {sections.map((item) => (
          <button key={item.id} type="button" onClick={() => setSection(item.id)} className={cx("rounded-xl px-3 py-2.5 text-left text-[14.5px]", section === item.id ? "bg-warm font-semibold text-ink" : "font-medium text-ink-2 hover:bg-surface-alt")}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="flex max-w-[760px] flex-col gap-[22px] px-12 py-9">
          {section === "estudo" && (
            <>
              <div>
                <div className="text-[22px] font-semibold">Estudo</div>
                <div className="mt-1 text-[14.5px] text-ink-2">Como o app abre e o que aparece na vista.</div>
              </div>
              <Group>
                <SettingLine title="Ao abrir o app" sub="Início mostra o painel; Guiado volta ao último pack; Livre abre o modelo inteiro" right={<Seg size="s" className="w-[270px]" options={startOptions} value={settings.startScreen} onChange={(value) => setSettings({ startScreen: value })} label="Ao abrir o app" />} />
                <SettingLine title="Rótulos na vista" sub="Nome da estrutura junto a cada pino (desligado: só o número)" right={<Switch on={settings.labelNames} onChange={(value) => setSettings({ labelNames: value })} label="Rótulos na vista" />} />
                <SettingLine title="Texto da vista" sub="Tamanho no painel e no modo aula" right={<Seg size="s" className="w-[160px]" options={sizeOptions} value={settings.textSize} onChange={(value) => setSettings({ textSize: value })} label="Texto da vista" />} />
              </Group>
              <Group>
                <SettingLine title="Anotações no modo aula" sub="Mostrar suas notas pessoais durante a apresentação" right={<Switch on={settings.presentNotes} onChange={(value) => setSettings({ presentNotes: value })} label="Anotações no modo aula" />} />
              </Group>
            </>
          )}
          {section === "visualizador" && (
            <>
              <div>
                <div className="text-[22px] font-semibold">Visualizador</div>
                <div className="mt-1 text-[14.5px] text-ink-2">Detalhe do modelo e uso sem internet.</div>
              </div>
              <Group>
                <SettingLine title="Qualidade do modelo" sub="Automática: completo (2 milhões de triângulos) no computador, leve no celular" right={<Seg size="s" className="w-[330px]" options={qualityOptions} value={settings.quality} onChange={(value) => setSettings({ quality: value })} label="Qualidade do modelo" />} />
                <SettingLine title="Uso sem internet" sub="Instale o app pelo navegador; depois do primeiro acesso, os packs abertos funcionam offline." />
              </Group>
            </>
          )}
          {section === "atalhos" && (
            <>
              <div className="text-[22px] font-semibold">Atalhos de teclado</div>
              <Group>
                {shortcuts.map(([keys, text]) => (
                  <div key={keys} className="flex items-center gap-4 px-5 py-3.5">
                    <span className="min-w-[120px] font-mono text-[13px] font-medium">
                      <span className="rounded-md border border-line bg-surface-alt px-2 py-1">{keys}</span>
                    </span>
                    <span className="text-[14.5px] text-ink-2">{text}</span>
                  </div>
                ))}
              </Group>
            </>
          )}
          {section === "sobre" && (
            <>
              <div className="text-[22px] font-semibold">Sobre o modelo</div>
              <AboutContent />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
