import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { CATALOG } from './catalog';
import {
  calculateStack,
  compareWithBaseline,
  normalizeHex,
  parseTransmittance,
} from './color';
import {
  clearStoredBaseline,
  loadScheme,
  saveScheme,
  STORAGE_KEY,
} from './storage';
import type {
  BaselineSnapshot,
  Gel,
  StackLayer,
  StackResult,
} from './types';
import './styles.css';

type DragSource =
  | { kind: 'catalog'; gel: Gel }
  | { kind: 'layer'; layerIndex: number };

interface DragState {
  source: DragSource;
  pointer: { x: number; y: number };
  label: string;
  hex: string;
}

function createLayer(gel: Gel): StackLayer {
  return {
    ...gel,
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `layer-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  };
}

function getBrowserStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function App() {
  const initialScheme = useMemo(() => {
    const storage = getBrowserStorage();
    return storage ? loadScheme(storage) : null;
  }, []);

  const [catalog, setCatalog] = useState<Gel[]>(() => [...CATALOG]);
  const [layers, setLayers] = useState<StackLayer[]>(
    () => initialScheme?.layers ?? [],
  );
  const [baseline, setBaseline] = useState<BaselineSnapshot | null>(
    () => initialScheme?.baseline ?? null,
  );
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [hexInput, setHexInput] = useState('');
  const [transmittanceInput, setTransmittanceInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const stageRef = useRef<HTMLOListElement | null>(null);
  const draggingRef = useRef<DragState | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const layersRef = useRef<StackLayer[]>(layers);

  layersRef.current = layers;
  dropIndexRef.current = dropIndex;

  useEffect(() => {
    const storage = getBrowserStorage();
    if (!storage) return;
    try {
      saveScheme(storage, layers, undefined, baseline);
    } catch {
      setNotice('浏览器无法写入 localStorage，本次方案暂时不能自动保存。');
    }
  }, [layers, baseline]);

  useEffect(() => {
    document.body.classList.toggle('is-dragging', dragging !== null);
    return () => document.body.classList.remove('is-dragging');
  }, [dragging]);

  useEffect(() => {
    function resolveStageIndex(clientY: number): number | null {
      const stage = stageRef.current;
      if (!stage) return null;
      const stageRect = stage.getBoundingClientRect();
      if (
        clientY < stageRect.top - 12 ||
        clientY > stageRect.bottom + 12
      ) {
        return null;
      }

      const rows = Array.from(
        stage.querySelectorAll<HTMLElement>('[data-layer-index]'),
      );
      if (rows.length === 0) return 0;

      for (let index = 0; index < rows.length; index += 1) {
        const rect = rows[index].getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) {
          return index;
        }
      }
      return rows.length;
    }

    function handlePointerMove(event: PointerEvent) {
      const current = draggingRef.current;
      if (!current) return;
      event.preventDefault();
      const nextIndex = resolveStageIndex(event.clientY);
      dropIndexRef.current = nextIndex;
      setDropIndex(nextIndex);
      setDragging({
        ...current,
        pointer: { x: event.clientX, y: event.clientY },
      });
    }

    function finishDrag() {
      const current = draggingRef.current;
      const targetIndex = dropIndexRef.current;
      const currentLayers = layersRef.current;

      if (current && targetIndex !== null) {
        if (current.source.kind === 'catalog') {
          if (currentLayers.length >= 5) {
            setNotice('预检台最多只能叠放五张色片。');
          } else {
            const nextLayers = [...currentLayers];
            nextLayers.splice(targetIndex, 0, createLayer(current.source.gel));
            setLayers(nextLayers);
            setNotice(null);
          }
        }

        if (current.source.kind === 'layer') {
          const sourceIndex = current.source.layerIndex;
          const movedLayer = currentLayers[sourceIndex];
          if (movedLayer) {
            const nextLayers = currentLayers.filter(
              (_, index) => index !== sourceIndex,
            );
            nextLayers.splice(
              Math.min(targetIndex, nextLayers.length),
              0,
              movedLayer,
            );
            setLayers(nextLayers);
            setNotice(null);
          }
        }
      }

      draggingRef.current = null;
      dropIndexRef.current = null;
      setDragging(null);
      setDropIndex(null);
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
    };
  }, []);

  const result: StackResult | null = useMemo(() => {
    if (layers.length === 0) return null;
    return calculateStack(layers);
  }, [layers]);

  const comparison = useMemo(() => {
    if (!baseline || !result) return null;
    return compareWithBaseline(baseline.result, result);
  }, [baseline, result]);

  function handleSetBaseline() {
    if (!result) {
      setNotice('预检台为空，无法设为基准；已确认的基准保持不变。');
      return;
    }
    setBaseline({
      savedAt: new Date().toISOString(),
      layers: layers.map((layer) => ({ ...layer })),
      result,
    });
    setNotice('已设为基准，继续调整一至五层色片即可查看对比。');
  }

  function handleClearBaseline() {
    setBaseline(null);
    const storage = getBrowserStorage();
    if (storage) {
      try {
        clearStoredBaseline(storage);
      } catch {
        // 内存中的基准已清除，存储清理失败不影响本次操作。
      }
    }
    setNotice('已清除基准，回到单方案预检。');
  }

  function beginDrag(
    event: ReactPointerEvent<HTMLElement>,
    source: DragSource,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    window.getSelection()?.removeAllRanges();

    const gel =
      source.kind === 'catalog'
        ? source.gel
        : layersRef.current[source.layerIndex];
    if (!gel) return;

    const next: DragState = {
      source,
      pointer: { x: event.clientX, y: event.clientY },
      label: gel.name,
      hex: gel.hex,
    };
    draggingRef.current = next;
    dropIndexRef.current = resolveStageIndexFromPoint(event.clientY);
    setDropIndex(dropIndexRef.current);
    setDragging(next);
  }

  function resolveStageIndexFromPoint(clientY: number): number | null {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    if (clientY < rect.top - 12 || clientY > rect.bottom + 12) return null;
    const rows = Array.from(
      stage.querySelectorAll<HTMLElement>('[data-layer-id]'),
    );
    if (rows.length === 0) return 0;
    for (let index = 0; index < rows.length; index += 1) {
      const rowRect = rows[index].getBoundingClientRect();
      if (clientY < rowRect.top + rowRect.height / 2) return index;
    }
    return rows.length;
  }

  function appendGel(gel: Gel) {
    if (layers.length >= 5) {
      setNotice('预检台最多只能叠放五张色片。');
      return;
    }
    setLayers((current) => [...current, createLayer(gel)]);
    setNotice(null);
  }

  function removeLayer(layerIndex: number) {
    setLayers((current) =>
      current.filter((_, index) => index !== layerIndex),
    );
  }

  function addCustomGel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const hex = normalizeHex(hexInput);
      const transmittance = parseTransmittance(
        Number.isNaN(Number(transmittanceInput))
          ? Number.NaN
          : Number(transmittanceInput),
      );
      const gel: Gel = {
        id:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: name.trim() || `自定义色片 ${catalog.length + 1}`,
        hex,
        transmittance,
      };
      setCatalog((current) => [gel, ...current]);
      setName('');
      setHexInput('');
      setTransmittanceInput('');
      setFormError(null);
      setNotice('自定义色片已加入目录，可拖入预检台。');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '色片信息不合法。');
    }
  }

  const storedKey = STORAGE_KEY;

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Backstage Lighting Pre-check</p>
          <h1>舞台色片叠放预检台</h1>
          <p className="subtitle">
            拖入一至五张色片，按光线路径调整顺序，装台前先核对颜色与透光率损失。
          </p>
        </div>
        <div className="capacity" aria-label="当前叠放数量">
          <strong>{layers.length}</strong>
          <span>/ 5 张</span>
        </div>
      </header>

      <section className="workspace" aria-label="色片预检工作区">
        <aside className="panel catalog-panel" aria-labelledby="catalog-title">
          <div className="panel-heading">
            <h2 id="catalog-title">色片目录</h2>
            <p>拖到右侧，或点击“加入”</p>
          </div>

          <form className="custom-form" onSubmit={addCustomGel} noValidate>
            <h3>录入自定义色片</h3>
            <label>
              名称
              <input
                data-testid="custom-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：定制湖蓝"
              />
            </label>
            <label>
              六位十六进制 sRGB
              <input
                data-testid="custom-hex"
                value={hexInput}
                onChange={(event) => setHexInput(event.target.value)}
                placeholder="#2A66B1"
                aria-invalid={formError ? true : undefined}
              />
            </label>
            <label>
              透光率（1–100 的整数）
              <input
                data-testid="custom-transmittance"
                value={transmittanceInput}
                onChange={(event) =>
                  setTransmittanceInput(event.target.value)
                }
                inputMode="numeric"
                placeholder="65"
              />
            </label>
            {formError && (
              <p className="form-error" role="alert" data-testid="form-error">
                {formError}
              </p>
            )}
            <button type="submit" className="primary-button">
              加入目录
            </button>
          </form>

          <ul className="catalog-list" data-testid="catalog-list">
            {catalog.map((gel) => (
              <li
                key={gel.id}
                className="catalog-card"
                onPointerDown={(event) =>
                  beginDrag(event, { kind: 'catalog', gel })
                }
                data-testid="catalog-item"
                data-gel-id={gel.id}
                draggable={false}
              >
                <span
                  className="swatch-chip"
                  style={{ backgroundColor: gel.hex }}
                  aria-hidden="true"
                />
                <span className="gel-copy">
                  <strong>{gel.name}</strong>
                  <small>
                    {gel.hex} · {gel.transmittance}%
                  </small>
                </span>
                <button
                  type="button"
                  className="mini-button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => appendGel(gel)}
                >
                  加入
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="panel stage-panel" aria-labelledby="stage-title">
          <div className="panel-heading horizontal-heading">
            <div>
              <h2 id="stage-title">实际叠放次序</h2>
              <p>上方靠近光源，下方为输出侧；拖动色片可调整顺序。</p>
            </div>
            {layers.length > 0 && (
              <button
                type="button"
                className="text-button"
                onClick={() => setLayers([])}
              >
                清空
              </button>
            )}
          </div>

          <ol
            ref={stageRef}
            className={`stage ${layers.length === 0 ? 'is-empty' : ''} ${
              dropIndex !== null && dragging ? 'is-active-drop' : ''
            }`}
            data-testid="stage"
            data-drop-index={dropIndex ?? ''}
            aria-label="色片叠放区"
          >
            {layers.length === 0 && (
              <li className="empty-stage">
                <strong>将色片拖到这里</strong>
                <span>至少一张，最多五张</span>
              </li>
            )}
            {layers.map((layer, index) => (
              <li
                key={`${layer.id}-${index}`}
                data-layer-index={index}
                className="layer-row"
              >
                {dropIndex === index && dragging && (
                  <span className="drop-indicator" aria-hidden="true" />
                )}
                <div
                  className="layer-card"
                  onPointerDown={(event) =>
                    beginDrag(event, { kind: 'layer', layerIndex: index })
                  }
                  data-testid="stack-layer"
                  draggable={false}
                >
                  <span className="drag-handle" aria-hidden="true">
                    ⋮⋮
                  </span>
                  <span
                    className="layer-order"
                    aria-label={`第 ${index + 1} 张，光源侧排序`}
                  >
                    第 {index + 1} 张
                  </span>
                  <span
                    className="swatch-chip"
                    style={{ backgroundColor: layer.hex }}
                    aria-hidden="true"
                  />
                  <span className="gel-copy">
                    <strong>{layer.name}</strong>
                    <small>
                      {layer.hex} · 单层 {layer.transmittance}%
                    </small>
                  </span>
                </div>
                <button
                  type="button"
                  className="remove-button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => removeLayer(index)}
                  aria-label={`移除 ${layer.name}`}
                  data-testid="remove-layer"
                >
                  ×
                </button>
              </li>
            ))}
            {dropIndex === layers.length &&
              layers.length > 0 &&
              dragging && (
                <li className="indicator-row" aria-hidden="true">
                  <span className="drop-indicator" />
                </li>
              )}
          </ol>

          {notice && (
            <p className="notice" role="status" data-testid="notice">
              {notice}
            </p>
          )}
        </section>

        <aside className="panel result-panel" aria-labelledby="result-title">
          <div className="panel-heading horizontal-heading">
            <div>
              <h2 id="result-title">预检结果</h2>
              <p>按题目指定 sRGB 线性空间逐通道计算</p>
            </div>
            <div className="baseline-actions">
              <button
                type="button"
                className="mini-button"
                onClick={handleSetBaseline}
                data-testid="set-baseline"
              >
                设为基准
              </button>
              {baseline && (
                <button
                  type="button"
                  className="text-button"
                  onClick={handleClearBaseline}
                  data-testid="clear-baseline"
                >
                  清除基准
                </button>
              )}
            </div>
          </div>

          {result ? (
            <>
              {baseline && comparison ? (
                <div className="compare-swatches" data-testid="compare-swatches">
                  <figure className="compare-figure">
                    <div
                      className="final-swatch compare-swatch"
                      style={{ backgroundColor: baseline.result.hex }}
                      role="img"
                      aria-label={`基准色块 ${baseline.result.hex}`}
                      data-testid="baseline-swatch"
                    />
                    <figcaption>基准 {baseline.result.hex}</figcaption>
                  </figure>
                  <figure className="compare-figure">
                    <div
                      className="final-swatch compare-swatch"
                      style={{ backgroundColor: result.hex }}
                      role="img"
                      aria-label={`当前色块 ${result.hex}`}
                      data-testid="final-swatch"
                    />
                    <figcaption>当前 {result.hex}</figcaption>
                  </figure>
                </div>
              ) : (
                <div
                  className="final-swatch"
                  style={{ backgroundColor: result.hex }}
                  role="img"
                  aria-label={`最终色块 ${result.hex}`}
                  data-testid="final-swatch"
                />
              )}
              <dl className="result-list">
                <div>
                  <dt>最终颜色</dt>
                  <dd data-testid="final-hex">{result.hex}</dd>
                </div>
                <div>
                  <dt>sRGB 通道</dt>
                  <dd data-testid="final-rgb">
                    R {result.rgb[0]} / G {result.rgb[1]} / B {result.rgb[2]}
                  </dd>
                </div>
                <div>
                  <dt>综合透光率</dt>
                  <dd data-testid="final-transmittance">
                    {result.transmittancePercent.toFixed(1)}%
                  </dd>
                </div>
                <div>
                  <dt>明暗结论</dt>
                  <dd>
                    <span
                      className={`conclusion ${
                        result.conclusion === '可用' ? 'usable' : 'too-dark'
                      }`}
                      data-testid="final-conclusion"
                    >
                      {result.conclusion}
                    </span>
                  </dd>
                </div>
                {baseline && comparison && (
                  <>
                    <div>
                      <dt>颜色差 ΔE76</dt>
                      <dd data-testid="color-difference">
                        {comparison.colorDifference.toFixed(1)}
                      </dd>
                    </div>
                    <div>
                      <dt>亮度差</dt>
                      <dd data-testid="transmittance-difference">
                        {comparison.transmittanceDifference.toFixed(1)} 个百分点
                      </dd>
                    </div>
                    <div>
                      <dt>替代结论</dt>
                      <dd>
                        <span
                          className={`conclusion ${
                            comparison.verdict === '可替代'
                              ? 'substitutable'
                              : 'deviating'
                          }`}
                          data-testid="comparison-verdict"
                        >
                          {comparison.verdict}
                        </span>
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              <p className="formula-note">
                判定线：综合透光率四舍五入到 0.1% 后，不低于 20.0% 为可用，否则为过暗。
              </p>
              {baseline && comparison && (
                <p className="formula-note">
                  替代判定：颜色差（Delta E 76）不超过 8 且亮度差不超过 5.0
                  个百分点为可替代，否则偏差明显。
                </p>
              )}
            </>
          ) : baseline ? (
            <div className="empty-result" data-testid="empty-result">
              <div className="compare-swatches">
                <figure className="compare-figure">
                  <div
                    className="final-swatch compare-swatch"
                    style={{ backgroundColor: baseline.result.hex }}
                    role="img"
                    aria-label={`基准色块 ${baseline.result.hex}`}
                    data-testid="baseline-swatch"
                  />
                  <figcaption>基准 {baseline.result.hex}</figcaption>
                </figure>
                <figure className="compare-figure">
                  <div
                    className="placeholder-swatch compare-swatch"
                    aria-hidden="true"
                  />
                  <figcaption>当前 空</figcaption>
                </figure>
              </div>
              <p>基准已建立，当前预检台为空；放入色片后显示对比。</p>
            </div>
          ) : (
            <div className="empty-result" data-testid="empty-result">
              <div className="placeholder-swatch" aria-hidden="true" />
              <p>放入色片后显示最终颜色、透光率和明暗结论。</p>
            </div>
          )}

          <p className="storage-note" data-testid="storage-key">
            最近一次有效方案保存在 <code>{storedKey}</code>
          </p>
        </aside>
      </section>
      {dragging && (
        <div
          className="drag-preview"
          style={{
            transform: `translate(${dragging.pointer.x + 14}px, ${
              dragging.pointer.y + 14
            }px)`,
          }}
          aria-hidden="true"
        >
          <span
            className="swatch-chip"
            style={{ backgroundColor: dragging.hex }}
          />
          <span>{dragging.label}</span>
        </div>
      )}
    </main>
  );
}

export default App;
