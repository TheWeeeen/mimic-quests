import React, { useEffect, useMemo, useState } from 'react';
import { Search, X, Gamepad2, Sparkles, AlertTriangle, CheckCircle2, Timer } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { tauriApi } from '@/lib/tauri';
import type { SpoofableGameItem, SpooferStatus, SpooferTickEvent } from '@/types/spoofer';

const MAX_SEARCH_RESULTS = 60;

const GAME_STORAGE_KEY = 'mimic.quest_game_id';
const DURATION_STORAGE_KEY = 'mimic.quest_duration_secs';

/** Discord play quests are 15 or 30 minutes; the rest are here for the odd one out. */
const DURATION_PRESETS = [15 * 60, 30 * 60, 45 * 60, 60 * 60];

function readSavedDuration(): number {
  try {
    const saved = Number(window.localStorage.getItem(DURATION_STORAGE_KEY));
    return DURATION_PRESETS.includes(saved) ? saved : DURATION_PRESETS[0];
  } catch {
    return DURATION_PRESETS[0];
  }
}

function writeSavedDuration(durationSecs: number): void {
  try {
    window.localStorage.setItem(DURATION_STORAGE_KEY, String(durationSecs));
  } catch {
    // storage unavailable — the timer just falls back to the default
  }
}

function readSavedGameId(): string | null {
  try {
    const saved = window.localStorage.getItem(GAME_STORAGE_KEY);
    return saved && saved.length > 0 ? saved : null;
  } catch {
    return null;
  }
}

function writeSavedGameId(gameId: string | null): void {
  try {
    if (gameId) window.localStorage.setItem(GAME_STORAGE_KEY, gameId);
    else window.localStorage.removeItem(GAME_STORAGE_KEY);
  } catch {
    // storage unavailable — the choice just won't survive a restart
  }
}

function formatClock(totalSecs: number): string {
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

interface QuestViewProps {
  status: SpooferStatus;
  tickData: SpooferTickEvent;
  isQuestRun: boolean;
  isBetaEnabled: boolean;
  isFetching: boolean;
  onStart: (gameId: string, durationSecs: number) => void;
  onStop: () => void;
}

const GameIcon: React.FC<{ game: SpoofableGameItem }> = ({ game }) =>
  game.icon_hash ? (
    <img
      src={`https://cdn.discordapp.com/app-icons/${game.id}/${game.icon_hash}.png?size=64`}
      alt=""
      className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
      onError={(e) => {
        (e.target as HTMLElement).style.display = 'none';
      }}
    />
  ) : (
    <div className="w-10 h-10 rounded-lg bg-[#242738] flex items-center justify-center flex-shrink-0">
      <Gamepad2 className="w-5 h-5 text-[#5865F2]" />
    </div>
  );

/**
 * Quest mode: one game, one process, one fixed timer.
 *
 * A Discord play quest is credited from the client heartbeat while it sees the game
 * running, so the only thing that matters is a single process living for the quest
 * duration. Batching several games at once (the dashboard default) is exactly what the
 * quest tracker does not expect, so this tab pins the run to one native game and an
 * explicit timer, then leaves the rest to Discord.
 */
export const QuestView: React.FC<QuestViewProps> = ({
  status,
  tickData,
  isQuestRun,
  isBetaEnabled,
  isFetching,
  onStart,
  onStop,
}) => {
  const { t } = useI18n();
  const [games, setGames] = useState<SpoofableGameItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(readSavedGameId);
  const [searchTerm, setSearchTerm] = useState('');
  const [durationSecs, setDurationSecs] = useState<number>(readSavedDuration);

  const isIdle = status === 'idle' || status === 'finished' || status === 'error';
  const isRunning = !isIdle && isQuestRun;

  useEffect(() => {
    tauriApi
      .getGamesList()
      .then(setGames)
      .catch((err) => console.error('Failed to load games list:', err));
  }, [isFetching]);

  useEffect(() => {
    writeSavedGameId(selectedId);
  }, [selectedId]);

  useEffect(() => {
    writeSavedDuration(durationSecs);
  }, [durationSecs]);

  // Only native executables can be detected as a running game by the Discord client.
  const availableGames = useMemo(
    () => (isBetaEnabled ? games : games.filter((g) => g.method === 'process' && Boolean(g.rel_path))),
    [games, isBetaEnabled]
  );

  const selectedGame = useMemo(
    () => availableGames.find((g) => g.id === selectedId) ?? null,
    [availableGames, selectedId]
  );

  const searchResults = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return [];
    return availableGames
      .filter((g) => g.id !== selectedId)
      .filter(
        (g) =>
          g.name.toLowerCase().includes(term) ||
          (g.rel_path && g.rel_path.toLowerCase().includes(term)) ||
          g.id.includes(term)
      )
      .slice(0, MAX_SEARCH_RESULTS);
  }, [searchTerm, availableGames, selectedId]);

  const exeName = selectedGame?.rel_path?.split(/[\\/]/).pop() ?? null;

  return (
    <div className="flex flex-col h-full gap-3 overflow-hidden pr-1">
      {/* Header: duration + start/stop */}
      <div className="bg-[#161722] border border-[#232535] rounded-xl p-4 shadow-sm flex flex-col gap-3 flex-shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#5865F2]" />
              {t('quest.title')}
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">{t('quest.subtitle')}</p>
          </div>
          <span className="text-[11px] font-mono text-neutral-500 whitespace-nowrap">
            {t('quest.autoStop')}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="grid grid-cols-4 gap-1 flex-1">
            {DURATION_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                disabled={!isIdle}
                onClick={() => setDurationSecs(preset)}
                className={`py-1.5 px-1 text-[11px] rounded border transition-all disabled:opacity-50 ${
                  durationSecs === preset
                    ? 'bg-[#5865F2] text-white border-[#5865F2] font-semibold'
                    : 'bg-[#1b1c28] text-neutral-400 border-white/10 hover:text-white'
                }`}
              >
                {t('quest.durationMinutes', { count: preset / 60 })}
              </button>
            ))}
          </div>

          {isRunning ? (
            <div className="flex items-center gap-3">
              <div className="text-xs text-neutral-400 whitespace-nowrap">
                {t('quest.elapsed')}{' '}
                <span className="font-mono font-bold text-emerald-400">
                  {formatClock(tickData.elapsed_secs)}
                </span>
                {' · '}
                {t('quest.left')}{' '}
                <span className="font-mono font-bold text-white">
                  {formatClock(Math.max(tickData.estimated_remaining_secs, 0))}
                </span>
              </div>
              <button
                type="button"
                onClick={onStop}
                className="py-2 px-6 rounded-lg bg-[#3d181e] hover:bg-[#521e27] text-white font-semibold text-xs uppercase tracking-wider transition-all"
              >
                {t('dashboard.stop')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={!isIdle || !selectedGame}
              onClick={() => selectedGame && onStart(selectedGame.id, durationSecs)}
              className="py-2 px-6 rounded-lg bg-[#5865F2] hover:bg-[#4752c4] text-white font-semibold text-xs uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('quest.start')}
            </button>
          )}
        </div>

        {!isIdle && !isQuestRun && (
          <div className="text-[11px] text-amber-400">{t('quest.busy')}</div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1 min-h-0 overflow-hidden">
        {/* Chosen quest game + search */}
        <div className="bg-[#161722] border border-[#232535] rounded-xl p-4 flex flex-col shadow-sm min-h-0 overflow-hidden">
          <h3 className="text-sm font-semibold text-white pb-2 border-b border-white/5 flex-shrink-0">
            {t('quest.gameTitle')}
          </h3>

          {selectedGame ? (
            <div className="mt-3 p-3 rounded-lg bg-[#1b1c28] border border-[#5865F2]/40 flex items-start gap-3 flex-shrink-0">
              <GameIcon game={selectedGame} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white truncate">{selectedGame.name}</div>
                <div className="text-[11px] text-neutral-400 font-mono truncate">
                  {exeName ?? selectedGame.rel_path}
                </div>
                <div className="text-[10px] text-neutral-500 font-mono mt-0.5">
                  app id {selectedGame.id}
                </div>
              </div>
              {isIdle && (
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/5 flex-shrink-0"
                  title={t('quest.change')}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <div className="mt-3 p-3 rounded-lg bg-[#1b1c28] border border-white/5 text-xs text-neutral-500 flex-shrink-0">
              {t('quest.emptySelection')}
            </div>
          )}

          <div className="relative mt-3 flex-shrink-0">
            <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder={t('quest.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#1b1c28] border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-[#5865F2]"
            />
          </div>

          <div className="flex-1 overflow-y-auto pr-1 mt-2 space-y-1.5 min-h-0">
            {searchResults.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center text-xs text-neutral-500 p-4">
                {searchTerm.trim() ? t('database.empty') : t('quest.searchHint')}
              </div>
            ) : (
              searchResults.map((game) => (
                <button
                  key={game.id}
                  type="button"
                  disabled={!isIdle}
                  onClick={() => {
                    setSelectedId(game.id);
                    setSearchTerm('');
                  }}
                  className="w-full flex items-center gap-2.5 p-2 rounded-lg bg-[#1b1c28] border border-white/5 text-xs text-left hover:border-[#5865F2]/50 disabled:opacity-40"
                >
                  <GameIcon game={game} />
                  <div className="min-w-0">
                    <div className="font-medium text-white truncate">{game.name}</div>
                    <div className="text-[10px] text-neutral-500 font-mono truncate">
                      {game.rel_path}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* How to run it + honest limits */}
        <div className="bg-[#161722] border border-[#232535] rounded-xl p-4 flex flex-col shadow-sm min-h-0 overflow-y-auto">
          <h3 className="text-sm font-semibold text-white pb-2 border-b border-white/5 flex-shrink-0 flex items-center gap-2">
            <Timer className="w-4 h-4 text-[#5865F2]" />
            {t('quest.stepsTitle')}
          </h3>

          <ol className="mt-3 space-y-2 text-xs text-neutral-300">
            {[t('quest.step1'), t('quest.step2'), t('quest.step3'), t('quest.step4')].map(
              (step, index) => (
                <li key={index} className="flex items-start gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span>{step}</span>
                </li>
              )
            )}
          </ol>

          <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-amber-400 uppercase tracking-wider">
              <AlertTriangle className="w-3.5 h-3.5" />
              {t('quest.warnTitle')}
            </div>
            <ul className="mt-2 space-y-1.5 text-[11px] text-amber-200/90">
              {[t('quest.warn1'), t('quest.warn2'), t('quest.warn3'), t('quest.warn4')].map(
                (warning, index) => (
                  <li key={index} className="flex items-start gap-1.5">
                    <span className="text-amber-500">•</span>
                    <span>{warning}</span>
                  </li>
                )
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
