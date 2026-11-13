"use client";

import { useMemo, useState, type ReactNode } from "react";
import { groupIcon, groupShort, packEntry, packGroups, search, viewCount, type Pack, type PackGroup, type SearchHit } from "@/lib/catalog";
import { setSettings, toggleSaved, useNotes, useSettings, type Quality, type StartScreen, type TextSize } from "@/lib/store";
import { Cover } from "@/components/ui/Cover";
import { Icon, type IconName } from "@/components/ui/Icon";
import { BackHeader, Btn, Card, Chip, Circ, cx, Empty, Group, H1, Highlight, Lbl, Pick, SearchField, Seg, Switch, Brand } from "@/components/ui/kit";
import type { AppNav } from "../nav";
import { AboutContent, NoteCard, useContinue, usePackProgress } from "../shared";

// ---- frame -----------------------------------------------------------------------------------------------

const tabs: { id: "home" | "library" | "notes" | "profile"; icon: IconName; label: string }[] = [
  { id: "home", icon: "home", label: "Início" },
  { id: "library", icon: "book", label: "Biblioteca" },
  { id: "notes", icon: "pen", label: "Anotações" },
  { id: "profile", icon: "user", label: "Perfil" },
];

/** Floating tab bar of the phone app. */
export function MTabs({ nav }: { nav: AppNav }) {
  const active = nav.route.name;
  return (
    <nav aria-label="Navegação principal" className="fixed inset-x-4 bottom-[max(10px,env(safe-area-inset-bottom))] z-30 mx-auto flex h-[74px] max-w-[528px] items-center justify-around rounded-[30px] bg-surface px-2 shadow-up">
      {tabs.map((tab) => {
        const on = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={on ? "page" : undefined}
            onClick={() => (on ? undefined : nav.go({ name: tab.id }))}
            className={cx("flex flex-col items-center gap-[5px] rounded-[20px] px-3.5 py-[9px] transition-colors", on ? "bg-warm text-ink" : "text-ink-2")}
          >
            <Icon name={tab.icon} size={22} stroke={on ? 2 : 1.6} />
            <span className={cx("text-[12.5px]", on ? "font-semibold" : "font-medium")}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** Scrolling page of a tab (content width capped on tablets). */
function Page({ children, header, tabbed = true }: { children: ReactNode; header?: ReactNode; tabbed?: boolean }) {
  return (
    <div className="fixed inset-0 flex flex-col bg-paper pt-safe">
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col overflow-hidden">
        {header}
        <div className={cx("flex flex-1 flex-col gap-[18px] overflow-y-auto px-[22px]", tabbed ? "pb-[110px]" : "pb-8")}>{children}</div>
      </div>
    </div>
  );
}

// ---- Início ----------------------------------------------------------------------------------------------

export function MHome({ nav }: { nav: AppNav }) {
  const next = useContinue();
  return (
    <>
      <Page
        header={
          <div className="flex shrink-0 items-center gap-3 px-[22px] pb-3.5 pt-2.5">
            <Brand />
            <div className="flex-1" />
            <Circ icon="search" size={42} onClick={() => nav.go({ name: "search" })} label="Buscar" />
          </div>
        }
      >
        <H1 sub={next.fresh ? "Escolha um pack ou abra o modelo inteiro." : `Você parou no pack ${next.pack.title}.`}>{next.fresh ? "Comece por aqui" : "Continue de onde parou"}</H1>
        <Card padded={false} className="overflow-hidden">
          <button type="button" onClick={() => nav.continueLast()} className="relative block w-full text-left">
            <Cover packId={next.pack.id} groupId={next.group.id} viewId={next.view.id} className="h-[164px] w-full" rounded="rounded-none" label={next.pack.title} />
            <Chip tone="ink" size="s" className="absolute left-3.5 top-3.5">
              Guiado · vista {next.index + 1} de {next.pack.views.length}
            </Chip>
          </button>
          <div className="px-[18px] pb-[18px] pt-4">
            <Lbl className="text-rose-deep">{next.pack.title}</Lbl>
            <div className="mt-1 text-[22px] font-semibold tracking-[-0.5px]">{next.view.title}</div>
            <div className="mt-1 text-sm text-ink-2">{next.meta}</div>
            <div className="mt-3.5 flex gap-2.5">
              <Btn icon="arrowR" className="h-[50px] flex-1" onClick={() => nav.continueLast()}>
                {next.fresh ? "Começar" : "Continuar"}
              </Btn>
              <Btn variant="ghost" full={false} leading="present" className="h-[50px] gap-2 px-4 text-[15px]" onClick={() => nav.continueLast(true)}>
                Aula
              </Btn>
            </div>
          </div>
        </Card>
        <div>
          <Lbl className="mb-2.5">Como quer estudar</Lbl>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { icon: "flow" as const, title: "Guiado", text: "Pack vista a vista, com rótulos e texto", run: () => nav.go({ name: "library" }) },
              { icon: "cube" as const, title: "Livre", text: "Modelo inteiro: toque em qualquer estrutura", run: () => nav.openFree() },
            ].map((item) => (
              <Card key={item.title} as="button" onClick={item.run} className="p-4 active:bg-surface-alt">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-rose-tint text-rose-deep">
                  <Icon name={item.icon} size={20} />
                </div>
                <div className="mt-3 text-base font-semibold">{item.title}</div>
                <div className="mt-1 text-[13px] leading-[1.4] text-ink-2">{item.text}</div>
              </Card>
            ))}
          </div>
        </div>
        <div>
          <Lbl className="mb-2.5">Áreas</Lbl>
          <Group>
            {packGroups.map((group) => (
              <button key={group.id} type="button" onClick={() => nav.go({ name: "library", group: group.id })} className="flex w-full items-center gap-3.5 px-4 py-3 text-left active:bg-surface-alt">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-tint text-rose-deep">
                  <Icon name={groupIcon(group.id)} size={19} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-base font-semibold tracking-[-0.2px]">{group.title}</div>
                  <div className="mt-0.5 text-[13.5px] text-muted">
                    {group.packs.length} packs · {viewCount(group)} vistas
                  </div>
                </div>
                <Icon name="chevR" size={18} color="#B6ADB1" />
              </button>
            ))}
          </Group>
        </div>
      </Page>
      <MTabs nav={nav} />
    </>
  );
}

// ---- Biblioteca ------------------------------------------------------------------------------------------

function PackRow({ pack, group, first, onOpen }: { pack: Pack; group: PackGroup; first: boolean; onOpen: () => void }) {
  const progress = usePackProgress(pack.id);
  return (
    <button type="button" onClick={onOpen} className={cx("flex w-full items-center gap-3.5 px-3.5 py-3 text-left active:bg-surface-alt", !first && "border-t border-line-soft")}>
      <Cover packId={pack.id} groupId={group.id} className="h-[60px] w-[60px]" />
      <div className="min-w-0 flex-1">
        <div className="text-[15.5px] font-semibold tracking-[-0.2px]">{pack.title}</div>
        <div className="mt-0.5 text-[13px] leading-[1.35] text-ink-2" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {pack.summary}
        </div>
      </div>
      <div className="shrink-0 whitespace-nowrap text-right text-xs font-semibold text-muted">
        {pack.views.length} vistas
        {progress.count > 0 && <div className="mt-0.5 font-medium text-rose-deep">{progress.count}/{progress.total}</div>}
      </div>
    </button>
  );
}

export function MLibrary({ nav, group }: { nav: AppNav; group: string | null }) {
  const settings = useSettings();
  const [filter, setFilter] = useState<string | null>(group);
  const saved = settings.saved.map((id) => packEntry(id)).filter((entry): entry is NonNullable<ReturnType<typeof packEntry>> => Boolean(entry));
  const groups = packGroups.filter((item) => !filter || filter === item.id);
  return (
    <>
      <Page header={<div className="shrink-0 px-[22px] pt-2.5"><H1>Biblioteca</H1></div>}>
        <div className="flex flex-col gap-3.5 pt-4">
          <button type="button" onClick={() => nav.go({ name: "search" })} className="flex h-[54px] items-center gap-3 rounded-full border border-line bg-surface px-[18px] text-left text-base text-muted">
            <Icon name="search" size={20} />
            Estrutura, vista ou pack
          </button>
          <div className="no-scrollbar -mx-[22px] flex gap-2 overflow-x-auto px-[22px]">
            <Pick on={!filter} onClick={() => setFilter(null)}>
              Todos
            </Pick>
            {packGroups.map((item) => (
              <Pick key={item.id} on={filter === item.id} onClick={() => setFilter(item.id)}>
                {groupShort[item.id] ?? item.title}
              </Pick>
            ))}
            {saved.length > 0 && (
              <Pick on={filter === "salvos"} onClick={() => setFilter("salvos")}>
                Salvos
              </Pick>
            )}
          </div>
        </div>
        {filter === "salvos" ? (
          <section>
            <Lbl className="mb-2.5 mt-1">Salvos · {saved.length}</Lbl>
            <Card padded={false} className="overflow-hidden">
              {saved.map((entry, index) => (
                <PackRow key={entry.pack.id} pack={entry.pack} group={entry.group} first={index === 0} onOpen={() => nav.openPack(entry.pack.id)} />
              ))}
            </Card>
          </section>
        ) : (
          groups.map((item) => (
            <section key={item.id}>
              <Lbl className="mb-2.5 mt-1">
                {item.title} · {item.packs.length} packs
              </Lbl>
              <Card padded={false} className="overflow-hidden">
                {item.packs.map((pack, index) => (
                  <PackRow key={pack.id} pack={pack} group={item} first={index === 0} onOpen={() => nav.openPack(pack.id)} />
                ))}
              </Card>
            </section>
          ))
        )}
      </Page>
      <MTabs nav={nav} />
    </>
  );
}

// ---- Busca -----------------------------------------------------------------------------------------------

type SearchFilter = "all" | "structure" | "view" | "pack";
const searchSuggestions = ["Peitoral maior", "Pedículo", "Rotter", "Torácico longo", "Ptose"];

export function SearchResults({ hits, query, onPick, filter }: { hits: SearchHit[]; query: string; onPick: (hit: SearchHit) => void; filter: SearchFilter }) {
  const sections: { kind: SearchHit["kind"]; title: string }[] = [
    { kind: "structure", title: "Estruturas · abre no modo livre" },
    { kind: "view", title: "Vistas" },
    { kind: "pack", title: "Packs" },
  ];
  return (
    <>
      {sections
        .filter((section) => filter === "all" || filter === section.kind)
        .map((section) => {
          const items = hits.filter((hit) => hit.kind === section.kind).slice(0, filter === "all" ? 8 : 40);
          if (!items.length) return null;
          return (
            <section key={section.kind}>
              <Lbl className="mb-2">{section.title}</Lbl>
              <Group>
                {items.map((hit) => (
                  <button key={hit.kind + (hit.kind === "structure" ? hit.id : hit.kind === "view" ? `${hit.packId}/${hit.viewIndex}` : hit.packId)} type="button" onClick={() => onPick(hit)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-alt">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] border border-line-soft bg-surface-alt text-ink-2">
                      {hit.kind === "structure" ? <span className="h-3 w-3 rounded-full shadow-[inset_0_0_0_1px_rgba(34,28,32,.18)]" style={{ background: hit.color }} /> : <Icon name={hit.kind === "view" ? "flow" : "book"} size={18} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15.5px] font-semibold">
                        <Highlight text={hit.title} query={query} />
                      </div>
                      <div className="mt-px truncate text-[13px] text-muted">{hit.sub}</div>
                    </div>
                    <Icon name="chevR" size={17} color="#B6ADB1" />
                  </button>
                ))}
              </Group>
            </section>
          );
        })}
    </>
  );
}

export const openHit = (nav: AppNav, hit: SearchHit) => {
  if (hit.kind === "structure") nav.openFree(hit.id);
  else if (hit.kind === "view") nav.openView(hit.packId, hit.viewIndex);
  else nav.openPack(hit.packId);
};

export function MSearch({ nav }: { nav: AppNav }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SearchFilter>("all");
  const hits = useMemo(() => search(query), [query]);
  const count = (kind: SearchHit["kind"]) => hits.filter((hit) => hit.kind === kind).length;
  return (
    <div className="fixed inset-0 flex flex-col bg-paper pt-safe">
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2.5 px-[18px] pb-3.5 pt-2">
          <Circ icon="chevL" onClick={() => nav.back()} label="Voltar" />
          <SearchField value={query} onChange={setQuery} autoFocus placeholder="Estrutura, vista ou pack" className="flex-1" />
        </div>
        {query.trim().length >= 2 && (
          <div className="no-scrollbar flex shrink-0 gap-2 overflow-x-auto px-[22px] pb-4">
            <Pick on={filter === "all"} onClick={() => setFilter("all")}>
              Tudo · {hits.length}
            </Pick>
            <Pick on={filter === "structure"} onClick={() => setFilter("structure")}>
              Estruturas · {count("structure")}
            </Pick>
            <Pick on={filter === "view"} onClick={() => setFilter("view")}>
              Vistas · {count("view")}
            </Pick>
            <Pick on={filter === "pack"} onClick={() => setFilter("pack")}>
              Packs · {count("pack")}
            </Pick>
          </div>
        )}
        <div className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-[22px] pb-8">
          {query.trim().length < 2 ? (
            <Empty icon="search" title="Busque no atlas" sub="Estruturas abrem no modo livre, já selecionadas; vistas abrem no pack, no ponto certo.">
              <div className="flex flex-wrap justify-center gap-2">
                {searchSuggestions.map((item) => (
                  <Pick key={item} size="s" onClick={() => setQuery(item)}>
                    {item}
                  </Pick>
                ))}
              </div>
            </Empty>
          ) : hits.length ? (
            <SearchResults hits={hits} query={query} filter={filter} onPick={(hit) => openHit(nav, hit)} />
          ) : (
            <Empty icon="search" title="Nada encontrado" sub={`Nenhuma estrutura, vista ou pack com “${query.trim()}”.`} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Pack ------------------------------------------------------------------------------------------------

export function MPack({ nav, packId }: { nav: AppNav; packId: string }) {
  const settings = useSettings();
  const entry = packEntry(packId);
  const progress = usePackProgress(packId);
  if (!entry) return null;
  const { pack, group } = entry;
  const saved = settings.saved.includes(pack.id);
  const resume = progress.lastIndex >= 0 ? progress.lastIndex : 0;
  return (
    <div className="fixed inset-0 flex flex-col bg-paper pt-safe">
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col overflow-hidden">
        <BackHeader eyebrow={group.title} title={pack.title} onBack={() => nav.back({ name: "library" })} action={<Circ icon="bookmark" size={44} tone={saved ? "ink" : "surface"} active={saved} onClick={() => toggleSaved(pack.id)} label={saved ? "Remover dos salvos" : "Salvar pack"} />} />
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-[22px] pb-8">
          <Cover packId={pack.id} groupId={group.id} className="h-[190px] w-full" rounded="rounded-[22px]" label={pack.title} />
          <p className="text-pretty text-[15.5px] leading-normal text-ink-2">{pack.summary}</p>
          <div className="flex items-center justify-between">
            <Lbl>{pack.views.length} vistas</Lbl>
            <span className="text-[13px] text-muted">{progress.count ? `${progress.count} vistas · ${progress.percent}%` : "Nada visto ainda"}</span>
          </div>
          <Group>
            {pack.views.map((view, index) => {
              const seen = progress.seen.includes(view.id);
              const here = index === progress.lastIndex;
              return (
                <button key={view.id} type="button" onClick={() => nav.openView(pack.id, index)} className={cx("flex w-full items-center gap-3.5 px-4 py-3 text-left active:bg-surface-alt", here && "bg-surface-alt")}>
                  <span
                    className={cx("grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-[13px] font-bold", here ? "bg-ink text-on-ink" : seen ? "bg-sage-tint text-sage-deep" : "border border-line bg-surface-alt text-muted")}
                  >
                    {seen && !here ? <Icon name="check" size={15} stroke={2.2} /> : index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15.5px] font-semibold leading-snug">{view.title}</span>
                    {here && <span className="mt-px block text-[13px] font-medium text-rose-deep">Você parou aqui</span>}
                  </span>
                  <Icon name="chevR" size={17} color="#B6ADB1" />
                </button>
              );
            })}
          </Group>
          <Btn icon="arrowR" onClick={() => nav.openView(pack.id, resume)}>
            {progress.lastIndex >= 0 ? `Continuar na vista ${resume + 1}` : "Começar"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ---- Anotações -------------------------------------------------------------------------------------------

export function MNotes({ nav }: { nav: AppNav }) {
  const notes = useNotes();
  const [byPack, setByPack] = useState(false);
  const groups = useMemo(() => {
    const map = new Map<string, typeof notes>();
    notes.forEach((note) => map.set(note.packId, [...(map.get(note.packId) ?? []), note]));
    return [...map.entries()];
  }, [notes]);
  return (
    <>
      <Page header={<div className="shrink-0 px-[22px] pt-2.5"><H1 sub="Ficam presas à vista (e ao ponto do modelo) onde foram feitas.">Anotações</H1></div>}>
        {notes.length === 0 ? (
          <Empty icon="pen" title="Nenhuma anotação ainda" sub="Abra uma vista e toque em Anotar, ou use Anotar na ficha de uma estrutura.">
            <Btn full={false} className="h-12 px-5 text-[15px]" icon="arrowR" onClick={() => nav.continueLast()}>
              Abrir a última vista
            </Btn>
          </Empty>
        ) : (
          <>
            <div className="flex gap-2 pt-4">
              <Pick on={!byPack} onClick={() => setByPack(false)}>
                Todas · {notes.length}
              </Pick>
              <Pick on={byPack} onClick={() => setByPack(true)}>
                Por pack
              </Pick>
            </div>
            {byPack
              ? groups.map(([packId, items]) => (
                  <section key={packId} className="flex flex-col gap-3">
                    <Lbl>{packEntry(packId)?.pack.title ?? "Modo livre"} · {items.length}</Lbl>
                    {items.map((note) => (
                      <NoteCard key={note.id} note={note} onOpen={() => nav.openNote(note)} />
                    ))}
                  </section>
                ))
              : notes.map((note) => <NoteCard key={note.id} note={note} onOpen={() => nav.openNote(note)} />)}
          </>
        )}
      </Page>
      <MTabs nav={nav} />
    </>
  );
}

// ---- Perfil ----------------------------------------------------------------------------------------------

function Line({ title, sub, right, below }: { title: string; sub?: string; right?: ReactNode; below?: ReactNode }) {
  return (
    <div className="px-4 py-[13px]">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[15.5px] font-semibold">{title}</div>
          {sub && <div className="mt-px text-[13px] leading-snug text-muted">{sub}</div>}
        </div>
        {right}
      </div>
      {below && <div className="mt-3">{below}</div>}
    </div>
  );
}

export const startOptions: { value: StartScreen; label: string }[] = [
  { value: "home", label: "Início" },
  { value: "guided", label: "Guiado" },
  { value: "free", label: "Livre" },
];
export const sizeOptions: { value: TextSize; label: string }[] = [
  { value: "s", label: "P" },
  { value: "m", label: "M" },
  { value: "l", label: "G" },
];
export const qualityOptions: { value: Quality; label: string }[] = [
  { value: "auto", label: "Automática" },
  { value: "low", label: "Leve" },
  { value: "high", label: "Completa" },
];

export function MProfile({ nav }: { nav: AppNav }) {
  const settings = useSettings();
  const notes = useNotes();
  const [about, setAbout] = useState(false);
  return (
    <>
      <Page header={<div className="shrink-0 px-[22px] pt-2.5"><H1>Perfil</H1></div>}>
        <div className="pt-4">
          <Card className="flex items-center gap-3.5 p-4">
            <div className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-full bg-ink text-on-ink">
              <Icon name="user" size={24} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold">Neste aparelho</div>
              <div className="text-[13.5px] text-muted">Progresso, {notes.length} {notes.length === 1 ? "anotação" : "anotações"} e ajustes ficam salvos neste navegador</div>
            </div>
          </Card>
        </div>
        <section>
          <Lbl className="mb-2">Estudo</Lbl>
          <Group>
            <Line title="Ao abrir o app" sub="Início, a última vista guiada ou o modelo inteiro" below={<Seg size="s" options={startOptions} value={settings.startScreen} onChange={(value) => setSettings({ startScreen: value })} label="Ao abrir o app" />} />
            <Line title="Rótulos na vista" sub="Mostrar nomes junto aos pinos" right={<Switch on={settings.labelNames} onChange={(value) => setSettings({ labelNames: value })} label="Rótulos na vista" />} />
            <Line title="Texto da vista" sub="Tamanho no painel e no modo aula" right={<Seg size="s" className="w-[150px]" options={sizeOptions} value={settings.textSize} onChange={(value) => setSettings({ textSize: value })} label="Texto da vista" />} />
          </Group>
        </section>
        <section>
          <Lbl className="mb-2">Visualizador</Lbl>
          <Group>
            <Line title="Qualidade do modelo" sub="Automática: modelo leve (0,7 milhão de triângulos) no celular, completo no computador" below={<Seg size="s" options={qualityOptions} value={settings.quality} onChange={(value) => setSettings({ quality: value })} label="Qualidade do modelo" />} />
            <Line title="Uso sem internet" sub="Instale o app (menu do navegador → Instalar app). Depois do primeiro acesso, os packs abertos funcionam offline." />
            <Line title="Anotações no modo aula" sub="Mostrar suas notas pessoais durante a apresentação" right={<Switch on={settings.presentNotes} onChange={(value) => setSettings({ presentNotes: value })} label="Anotações no modo aula" />} />
          </Group>
        </section>
        <section>
          <Lbl className="mb-2">Sobre</Lbl>
          <Group>
            <button type="button" onClick={() => setAbout(true)} className="w-full text-left active:bg-surface-alt">
              <Line title="Fontes anatômicas e créditos" sub="Visible Human, BodyParts3D, Z-Anatomy · licenças" right={<Icon name="chevR" size={17} color="#B6ADB1" />} />
            </button>
          </Group>
        </section>
      </Page>
      <MTabs nav={nav} />
      <MSheet open={about} onClose={() => setAbout(false)} eyebrow="MamaFlow Anatomia" title="Sobre o modelo">
        <AboutContent />
      </MSheet>
    </>
  );
}

// ---- sheet -----------------------------------------------------------------------------------------------

/** Modal bottom sheet (scrim, handle, title, close). */
export function MSheet({ open, onClose, eyebrow, title, children, maxHeight = "85dvh" }: { open: boolean; onClose: () => void; eyebrow?: string; title: string; children: ReactNode; maxHeight?: string }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className={cx("fixed inset-0 z-50 flex items-end justify-center bg-[rgba(20,15,17,.45)] transition-opacity duration-300", open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0")} onClick={onClose}>
      <div className={cx("flex w-full max-w-[640px] flex-col rounded-t-[28px] bg-surface shadow-sheet-lg transition-transform duration-300", open ? "translate-y-0" : "translate-y-12")} style={{ maxHeight }} onClick={(event) => event.stopPropagation()}>
        <div className="flex justify-center pb-1.5 pt-2.5">
          <div className="h-[5px] w-12 rounded-[3px] bg-line" />
        </div>
        <div className="flex items-start gap-3 border-b border-line-soft px-[22px] pb-4 pt-1.5">
          <div className="min-w-0 flex-1">
            {eyebrow && <Lbl className="mb-1 text-rose-deep">{eyebrow}</Lbl>}
            <div className="text-2xl font-semibold tracking-[-0.6px]">{title}</div>
          </div>
          <Circ icon="x" size={40} iconSize={17} onClick={onClose} label="Fechar" />
        </div>
        <div className="overflow-y-auto px-[22px] pb-[calc(22px+env(safe-area-inset-bottom))] pt-[18px]">{children}</div>
      </div>
    </div>
  );
}
