import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { CATALOG } from './catalog';
import {
  calculateLightPath,
  compareWithBaseline,
  DEFAULT_LIGHT_SOURCE,
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
  HexColor,
  LightPathCheckpoint,
  StackLayer,
  StackResult,
} from './types';
import './styles.css';

type DragSource =
  | { kind: 'catalog'; gel: Gel }
  | { kind: 'layer'; layerIndex: number };

interface DragState {
  source: DragSource;
  pointerId: number;
  start: { x: number; y: number };
  pointer: { x: number; y: number };
  label: string;
  hex: string;
  started: boolean;
}

const DRAG_ACTIVATION_DISTANCE = 5;

// 非法光源输入期间允许调整预览，但不覆盖最近一次有效方案。
const UNSAVED_NOTICE =
  '光源颜色未通过校验：本次调整仅更新预览，尚未写入最近一次有效方案。';

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
  const [lightSource, setLightSource] = useState<HexColor>(
    () => initialScheme?.lightSource ?? DEFAULT_LIGHT_SOURCE,
  );
  const [lightInput, setLightInput] = useState<string>(
    () => initialScheme?.lightSource ?? DEFAULT_LIGHT_SOURCE,
  );
  const [lightError, setLightError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [hexInput, setHexInput] = useState('');
  const [transmittanceInput, setTransmittanceInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  // 逐层光路明细默认收起，以维持原结果区布局。
  const [lightPathOpen, setLightPathOpen] = useState(false);

  const stageRef = useRef<HTMLOListElement | null>(null);
  const draggingRef = useRef<DragState | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const layersRef = useRef<StackLayer[]>(layers);

  layersRef.current = layers;
  dropIndexRef.current = dropIndex;

  useEffect(() => {
    if (lightError) {
      setNotice(UNSAVED_NOTICE);
      return;
    }

    const storage = getBrowserStorage();
    if (!storage) return;
    try {
      saveScheme(storage, layers, undefined, baseline, lightSource);
      // 恢复合法光源后方案已落盘，撤掉此前的未保存提示。
      setNotice((current) => (current === UNSAVED_NOTICE ? null : current));
    } catch {
      setNotice('浏览器无法写入 localStorage，本次方案暂时不能自动保存。');
    }
  }, [layers, baseline, lightSource, lightError]);

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
      if (!current || event.pointerId !== current.pointerId) return;

      if (!current.started) {
        const distance = Math.hypot(
          event.clientX - current.start.x,
          event.clientY - current.start.y,
        );
        if (distance < DRAG_ACTIVATION_DISTANCE) return;

        current.started = true;
        const target = event.target;
        if (target instanceof Element) {
          try {
            target.setPointerCapture(event.pointerId);
          } catch {
            // 某些已移除的 DOM 节点可能无法捕获；window 事件仍可完成本次手势。
          }
        }
      }

      event.preventDefault();
      const nextIndex = resolveStageIndex(event.clientY);
      dropIndexRef.current = nextIndex;
      const next: DragState = {
        ...current,
        pointer: { x: event.clientX, y: event.clientY },
      };
      draggingRef.current = next;
      setDropIndex(nextIndex);
      setDragging(next);
    }

    function clearDrag() {
      draggingRef.current = null;
      dropIndexRef.current = null;
      setDragging(null);
      setDropIndex(null);
    }

    function finishDrag(canceled: boolean) {
      const current = draggingRef.current;
      const targetIndex = dropIndexRef.current;
      const currentLayers = layersRef.current;

      // 普通松开且确实越过拖动阈值、落点也在叠放区时才提交；
      // pointercancel（浏览器/设备接管手势）只清理临时状态，不改层次。
      if (current?.started && !canceled && targetIndex !== null) {
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

      clearDrag();
    }

    function handlePointerUp(event: PointerEvent) {
      const current = draggingRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      finishDrag(false);
    }

    function handlePointerCancel(event: PointerEvent) {
      const current = draggingRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      finishDrag(true);
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, []);

  // 总结果与逐层检查点在同一次状态更新中由同一份有效光源与色片派生，
  // 拖动换序、增删色片或修改光源后两处一起重算。
  const { result, checkpoints } = useMemo<{
    result: StackResult | null;
    checkpoints: LightPathCheckpoint[];
  }>(() => {
    if (layers.length === 0) return { result: null, checkpoints: [] };
    const path = calculateLightPath(layers, lightSource);
    const last = path.last;
    return {
      checkpoints: path.checkpoints,
      result: {
        hex: last.hex,
        rgb: last.rgb,
        transmittancePercent: last.transmittancePercent,
        conclusion: last.conclusion,
      },
    };
  }, [layers, lightSource]);

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
      lightSource,
      result,
    });
    setNotice('已设为基准，继续调整光源或一至五层色片即可查看对比。');
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
    if (event.button !== 0 || draggingRef.current) return;
    event.preventDefault();
    window.getSelection()?.removeAllRanges();

    const gel =
      source.kind === 'catalog'
        ? source.gel
        : layersRef.current[source.layerIndex];
    if (!gel) return;

    // pointerdown 只记录手势；指针移动超过阈值后才视为拖放，避免普通点击改序。
    const next: DragState = {
      source,
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      pointer: { x: event.clientX, y: event.clientY },
      label: gel.name,
      hex: gel.hex,
      started: false,
    };
    draggingRef.current = next;
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

  // 旁路只切换该层的参与状态：不删除色片、不改变顺序，再次启用即恢复。
  function toggleLayerBypass(layerIndex: number) {
    setLayers((current) =>
      current.map((layer, index) => {
        if (index !== layerIndex) return layer;
        if (layer.bypassed) {
          const next = { ...layer };
          delete next.bypassed;
          return next;
        }
        return { ...layer, bypassed: true };
      }),
    );
    setNotice(null);
  }

  function handleLightInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setLightInput(value);
    try {
      // 只有合法六位颜色才进入计算与本地记录。
      setLightSource(normalizeHex(value));
      setLightError(null);
    } catch (error) {
      // 非法输入只提示格式问题，沿用上一次有效颜色。
      setLightError(
        error instanceof Error ? error.message : '光源颜色格式不合法。',
      );
    }
  }

  function handleResetLight() {
    setLightInput(DEFAULT_LIGHT_SOURCE);
    setLightSource(DEFAULT_LIGHT_SOURCE);
    setLightError(null);
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
              <p>先设定入射光源，再拖入色片；上方靠近光源，下方为输出侧。</p>
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

          <div className="light-control" data-testid="light-control">
            <span
              className="swatch-chip light-swatch"
              style={{ backgroundColor: lightSource }}
              aria-hidden="true"
              data-testid="light-swatch"
            />
            <label className="light-field">
              入射光源（六位十六进制 sRGB）
              <input
                data-testid="light-input"
                value={lightInput}
                onChange={handleLightInputChange}
                placeholder="#FFFFFF"
                aria-invalid={lightError ? true : undefined}
              />
            </label>
            <button
              type="button"
              className="mini-button"
              onClick={handleResetLight}
              data-testid="reset-light"
            >
              恢复白光
            </button>
          </div>
          {lightError && (
            <p
              className="form-error light-error"
              role="alert"
              data-testid="light-error"
            >
              {lightError}
            </p>
          )}

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
                  className={`layer-card${layer.bypassed ? ' is-bypassed' : ''}`}
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
                      {layer.bypassed ? ' · 已旁路' : ''}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="mini-button bypass-button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => toggleLayerBypass(index)}
                    aria-pressed={layer.bypassed === true}
                    aria-label={`${layer.bypassed ? '启用' : '旁路'} ${layer.name}`}
                    data-testid="toggle-bypass"
                  >
                    {layer.bypassed ? '启用' : '旁路'}
                  </button>
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
              <p>光源经 sRGB 线性化后与各层逐通道相乘</p>
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
                  <dt>入射光源</dt>
                  <dd data-testid="light-source-hex">{lightSource}</dd>
                </div>
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

              <div className="light-path" data-testid="light-path">
                <button
                  type="button"
                  className="disclosure-button"
                  aria-expanded={lightPathOpen}
                  aria-controls="light-path-panel"
                  onClick={() => setLightPathOpen((open) => !open)}
                  data-testid="light-path-toggle"
                >
                  <span className="disclosure-label">逐层光路</span>
                  <span className="disclosure-hint">
                    {lightPathOpen
                      ? '收起明细'
                      : '展开查看每经过一张色片后的累计色块、RGB 与透光率'}
                  </span>
                  <span
                    className={`disclosure-arrow${lightPathOpen ? ' is-open' : ''}`}
                    aria-hidden="true"
                  >
                    ▾
                  </span>
                </button>
                {lightPathOpen && (
                  <div
                    className="light-path-panel"
                    id="light-path-panel"
                    data-testid="light-path-panel"
                  >
                    <ol className="light-path-list">
                      <li
                        className="light-path-origin"
                        data-testid="light-path-origin"
                      >
                        <span className="checkpoint-order">光源</span>
                        <span
                          className="swatch-chip checkpoint-swatch"
                          style={{ backgroundColor: lightSource }}
                          aria-hidden="true"
                        />
                        <span className="checkpoint-copy">
                          <strong>入射光源起点</strong>
                          <small data-testid="checkpoint-origin-hex">
                            {lightSource}
                          </small>
                        </span>
                      </li>
                      {checkpoints.map((checkpoint) => (
                        <li
                          key={`${checkpoint.layerId}-${checkpoint.layerOrder}`}
                          className={`light-path-checkpoint${
                            checkpoint.participating ? '' : ' is-bypassed'
                          }`}
                          data-testid="light-path-checkpoint"
                          data-layer-id={checkpoint.layerId}
                          data-layer-order={checkpoint.layerOrder}
                          data-participating={checkpoint.participating}
                        >
                          <span className="checkpoint-order">
                            第 {checkpoint.layerOrder} 张
                          </span>
                          <span
                            className="swatch-chip checkpoint-swatch"
                            style={{ backgroundColor: checkpoint.hex }}
                            aria-hidden="true"
                          />
                          <span className="checkpoint-copy">
                            <strong data-testid="checkpoint-name">
                              {checkpoint.layerName}
                            </strong>
                            <small>
                              <span data-testid="checkpoint-hex">
                                {checkpoint.hex}
                              </span>
                              {' · '}
                              <span data-testid="checkpoint-rgb">
                                R {checkpoint.rgb[0]} / G {checkpoint.rgb[1]} / B{' '}
                                {checkpoint.rgb[2]}
                              </span>
                            </small>
                          </span>
                          <span className="checkpoint-metrics">
                            <span
                              className="checkpoint-transmittance"
                              data-testid="checkpoint-transmittance"
                            >
                              {checkpoint.transmittancePercent.toFixed(1)}%
                            </span>
                            {checkpoint.participating ? (
                              <span
                                className={`conclusion ${
                                  checkpoint.conclusion === '可用'
                                    ? 'usable'
                                    : 'too-dark'
                                }`}
                                data-testid="checkpoint-conclusion"
                              >
                                {checkpoint.conclusion}
                              </span>
                            ) : (
                              <span
                                className="conclusion bypassed"
                                data-testid="checkpoint-bypassed"
                              >
                                未参与
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ol>
                    <p className="formula-note light-path-note">
                      顺序与实际光路一致：上方靠近光源，末行即当前总结果；旁路层保留原位并标明未参与，数值继承上一检查点。
                    </p>
                  </div>
                )}
              </div>
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
