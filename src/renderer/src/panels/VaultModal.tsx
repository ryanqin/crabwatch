import { useEffect, useState } from 'react';
import { Md } from './SessionPanel';
import type { VaultNode } from '../../../shared/types';

/**
 * 内嵌 vault 浏览器（增量1，只读）：把 Obsidian 式 markdown 库搬进 crabwatch 看。
 * 左=文件树（文件夹可折叠），右=选中笔记用现成 Md() 渲染（含代码高亮）。
 * wikilink 可点 + backlinks 留下一小步。
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
  const [sel, setSel] = useState<string>();
  const [title, setTitle] = useState<string>();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void window.crabwatch.vaultList().then(setTree).catch(() => {});
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
                {loading ? <div className="vault-empty">loading…</div> : <Md text={text} />}
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
