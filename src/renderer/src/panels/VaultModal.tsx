import { useEffect, useState } from 'react';
import { Md } from './SessionPanel';
import type { VaultNode, VaultGraph } from '../../../shared/types';

/**
 * 内嵌 vault 浏览器（增量1，只读）：把 Obsidian 式 markdown 库搬进 crabwatch 看。
 * 左=文件树（文件夹可折叠），右=选中笔记用现成 Md() 渲染（含代码高亮）。
 * [[wikilink]] 可点跳转 + 底部 backlinks 面板（链接图 modal 打开时取一次）。
 */

function TreeNode({
  node,
  depth,
  selected,
  onPick,
}: {
  node: VaultNode;
  depth: number;
  selected?: string;
  onPick: (relPath: string, name: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1); // 顶层文件夹默认展开，深层默认收起
  const pad = { paddingLeft: depth * 12 + 8 };
  if (node.dir) {
    return (
      <div>
        <div
          className="vault-row vault-dir"
          style={pad}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="vault-caret">{open ? '▾' : '▸'}</span>
          {node.name}
        </div>
        {open &&
          node.children?.map((c) => (
            <TreeNode
              key={c.relPath}
              node={c}
              depth={depth + 1}
              selected={selected}
              onPick={onPick}
            />
          ))}
      </div>
    );
  }
  return (
    <div
      className={`vault-row vault-file${selected === node.relPath ? ' sel' : ''}`}
      style={pad}
      title={node.name}
      onClick={() => onPick(node.relPath, node.name)}
    >
      {node.name.replace(/\.md$/, '')}
    </div>
  );
}

export function VaultModal({ onClose }: { onClose: () => void }) {
  const [tree, setTree] = useState<VaultNode[]>([]);
  const [graph, setGraph] = useState<VaultGraph>();
  const [sel, setSel] = useState<string>();
  const [title, setTitle] = useState<string>();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void window.crabwatch.vaultList().then(setTree).catch(() => {});
    void window.crabwatch.vaultGraph().then(setGraph).catch(() => {});
  }, []);

  const pick = (relPath: string, name: string) => {
    setSel(relPath);
    setTitle(name.replace(/\.md$/, ''));
    setLoading(true);
    window.crabwatch
      .vaultRead(relPath)
      .then((t) => {
        setText(t);
        setLoading(false);
      })
      .catch(() => {
        setText('*(failed to read)*');
        setLoading(false);
      });
  };

  // [[X|显示]] 点击：取末段 basename 小写，经链接图解析到 relPath 再打开；解析不到则忽略
  const openByTarget = (rawTarget: string) => {
    const key = (rawTarget.split('#')[0].split('/').pop() ?? rawTarget)
      .replace(/\.md$/i, '')
      .trim()
      .toLowerCase();
    const rel = graph?.resolve[key];
    if (rel) pick(rel, rel.split('/').pop() ?? rel);
  };

  const backlinks = sel ? graph?.backlinks[sel] : undefined;

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal vault-modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <span>vault ▪ obsidian-brain</span>
          <button onClick={onClose}>×</button>
        </header>
        <div className="vault-split">
          <div className="vault-tree">
            {tree.length === 0 && <div className="vault-empty">(empty / loading…)</div>}
            {tree.map((n) => (
              <TreeNode
                key={n.relPath}
                node={n}
                depth={0}
                selected={sel}
                onPick={pick}
              />
            ))}
          </div>
          <div className="vault-view">
            {title ? (
              <>
                <div className="vault-view-title">{title}</div>
                {loading ? (
                  <div className="vault-empty">loading…</div>
                ) : (
                  <Md text={text} onWikiLink={openByTarget} />
                )}
                {backlinks && backlinks.length > 0 && (
                  <div className="vault-backlinks">
                    <div className="vault-bl-head">
                      linked from · {backlinks.length}
                    </div>
                    {backlinks.map((b) => (
                      <div
                        key={b.rel}
                        className="vault-bl-item"
                        title={b.rel}
                        onClick={() => pick(b.rel, b.name)}
                      >
                        {b.name.replace(/\.md$/, '')}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="vault-empty">select a note on the left</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
