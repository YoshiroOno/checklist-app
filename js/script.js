(function(){
  "use strict";

  /* ============================================================
     CONFIGURAÇÃO — cole aqui a URL do seu Google Apps Script
     ============================================================
     1. Siga o LEIAME-configuracao.md para publicar o script como
        "App da Web" e copiar a URL gerada (termina em /exec).
     2. Cole essa URL entre as aspas abaixo.
     3. Salve o arquivo. Pronto — todo mundo que abrir este HTML já
        sincroniza direto com a planilha, sem precisar configurar nada.

     Deixe em branco ("") se ainda não tiver a URL; o app funciona
     normalmente offline e você pode configurá-la depois pela tela
     de Configurações dentro do próprio app.
     ============================================================ */
  const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyA5rR8ASTDuI7_S-9z5gwXYedAr4cV-nRICFIlWe_MGLMjtjr0LMxR5HfJpbUEjjmP/exec";

  /* ============================================================
     LOGIN — os dois únicos usuários do app
     ============================================================
     "admin" tem acesso a tudo. "loja" só resolve tarefas (com foto
     de confirmação) e exporta PDF — sem criar, excluir ou mexer na
     configuração de sincronização.

     Isto roda inteiramente no navegador: não é uma trava de segurança
     de verdade (qualquer um com o arquivo pode ver o código-fonte),
     serve para organizar o fluxo de trabalho entre os dois perfis.
     ============================================================ */
  const USUARIOS = {
    "prev18": { senha: "adm18prev", papel: "admin" },
    "loja18": { senha: "loja18", papel: "loja" }
  };
  let sessaoAtual = null;

  async function getSessaoSalva(){
    const c = await dbGet("config", "sessao");
    return c ? c.value : null;
  }

  document.getElementById("btnLogin").addEventListener("click", fazerLogin);
  document.getElementById("loginPass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") fazerLogin();
  });

  async function fazerLogin(){
    const usuario = document.getElementById("loginUser").value.trim();
    const senha = document.getElementById("loginPass").value;
    const registro = USUARIOS[usuario];
    const erro = document.getElementById("loginError");
    if (!registro || registro.senha !== senha){
      erro.hidden = false;
      return;
    }
    erro.hidden = true;
    sessaoAtual = { usuario, papel: registro.papel };
    await dbPut("config", { key: "sessao", value: sessaoAtual });
    document.getElementById("loginUser").value = "";
    document.getElementById("loginPass").value = "";
    entrarNoApp();
  }

  document.getElementById("btnLogout").addEventListener("click", async () => {
    await dbDelete("config", "sessao");
    sessaoAtual = null;
    document.getElementById("app").hidden = true;
    document.getElementById("loginScreen").hidden = false;
    document.body.classList.remove("papel-loja");
  });

  function aplicarPermissoes(){
    document.body.classList.toggle("papel-loja", !!sessaoAtual && sessaoAtual.papel !== "admin");
  }

  function entrarNoApp(){
    document.getElementById("loginScreen").hidden = true;
    document.getElementById("app").hidden = false;
    aplicarPermissoes();
    (async () => {
      if (!navigator.onLine) setSyncStatus("offline");
      else { const u = await getWebAppUrl(); setSyncStatus(u ? "pendente" : "local"); }
    })();
    showView("menu");
    if (navigator.onLine) syncCycle();
  }

  /* ============================================================
     BANCO DE DADOS LOCAL (IndexedDB)
     Guarda listas, tarefas (com as imagens em base64) e config.
     ============================================================ */
  const DB_NAME = "checklistDB";
  const DB_VERSION = 3;
  let dbInstance = null;

  function dbOpen(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("lists")) {
          db.createObjectStore("lists", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("tasks")) {
          const ts = db.createObjectStore("tasks", { keyPath: "id" });
          ts.createIndex("listId", "listId", { unique: false });
        }
        if (!db.objectStoreNames.contains("config")) {
          db.createObjectStore("config", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("imageCache")) {
          db.createObjectStore("imageCache", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("pendingDeletes")) {
          db.createObjectStore("pendingDeletes", { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getDB(){
    if (!dbInstance) dbInstance = await dbOpen();
    return dbInstance;
  }

  async function dbPut(storeName, value){
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction([storeName], "readwrite");
      t.objectStore(storeName).put(value);
      t.oncomplete = () => resolve(value);
      t.onerror = () => reject(t.error);
    });
  }

  async function dbDelete(storeName, key){
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction([storeName], "readwrite");
      t.objectStore(storeName).delete(key);
      t.oncomplete = () => resolve(true);
      t.onerror = () => reject(t.error);
    });
  }

  async function dbGet(storeName, key){
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction([storeName]);
      const req = t.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbGetAll(storeName){
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction([storeName]);
      const req = t.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbGetAllByIndex(storeName, indexName, value){
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction([storeName]);
      const idx = t.objectStore(storeName).index(indexName);
      const req = idx.getAll(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function uuid(){
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === "x" ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /* ============================================================
     UTILITÁRIO DE IMAGEM — redimensiona/comprime antes de salvar
     ============================================================ */
  function fileToCompressedDataURL(file, maxDim, quality){
    maxDim = maxDim || 1280;
    quality = quality || 0.72;
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = () => { img.src = reader.result; };
      reader.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = height * (maxDim / width); width = maxDim; }
        else if (height > maxDim) { width = width * (maxDim / height); height = maxDim; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /* ============================================================
     RESOLUÇÃO DE IMAGENS SINCRONIZADAS (vindas de outro dispositivo)
     Localmente, uma tarefa recém-criada já guarda a foto como base64
     (pronta para exibir). Depois de sincronizada, ela passa a guardar
     só o ID do arquivo no Drive — para exibir, busca-se a foto (em
     base64, via o próprio Apps Script) uma vez e guarda em cache local,
     então nas próximas vezes é instantâneo e funciona offline.
     ============================================================ */
  function isImagemPronta(valor){
    return !valor || valor.indexOf("data:") === 0;
  }

  async function resolveImageSrc(valor){
    if (!valor) return "";
    if (valor.indexOf("data:") === 0) return valor; // já é a imagem em si

    const cache = await dbGet("imageCache", valor);
    if (cache) return cache.dataUri;

    const url = await getWebAppUrl();
    if (!url) return "";
    try{
      const sep = url.indexOf("?") >= 0 ? "&" : "?";
      const res = await fetch(url + sep + "imagem=" + encodeURIComponent(valor));
      const data = await res.json();
      if (!data || !data.success) return "";
      const dataUri = "data:" + (data.mime || "image/jpeg") + ";base64," + data.base64;
      await dbPut("imageCache", { id: valor, dataUri });
      return dataUri;
    }catch(err){
      return "";
    }
  }

  // Depois de inserir HTML com <img data-src="..."> (em vez de src direto),
  // chame isto para carregar cada imagem (do cache local ou buscando uma vez).
  function hydrateImages(container){
    container.querySelectorAll("img[data-src]").forEach(img => {
      const valor = img.getAttribute("data-src");
      if (!valor){ img.classList.add("img-empty"); return; }
      resolveImageSrc(valor).then(src => {
        if (src) img.src = src;
        else img.classList.add("img-empty");
      });
    });
  }

  /* ============================================================
     SINCRONIZAÇÃO COM GOOGLE SHEETS (via Google Apps Script)
     ============================================================ */
  async function getWebAppUrl(){
    if (WEB_APP_URL) return WEB_APP_URL; // definida diretamente no código — tem prioridade
    const c = await dbGet("config", "webAppUrl");
    return c ? c.value : "";
  }

  async function postToSheet(fields){
    const url = await getWebAppUrl();
    if (!url) return { ok:false, reason:"no-url" };
    try{
      const fd = new FormData();
      Object.entries(fields).forEach(([k,v]) => fd.append(k, v == null ? "" : String(v)));
      const res = await fetch(url, { method:"POST", body: fd });
      let data;
      try { data = await res.json(); } catch(_) { data = { success:true }; }
      return { ok: !!data.success, data };
    }catch(err){
      return { ok:false, reason:"network", error:String(err) };
    }
  }

  async function syncList(list){
    const r = await postToSheet({
      tipo: "lista", id: list.id, nome: list.nome, criadoEm: list.criadoEm, status: list.status
    });
    if (r.ok){ list.sincronizado = true; await dbPut("lists", list); }
    return r.ok;
  }

  async function syncTask(task){
    // Só manda a imagem em base64 se ela ainda não foi confirmada como
    // enviada — evita recriar o arquivo no Drive toda vez que a tarefa é
    // resincronizada por outro motivo (ex: ao resolver, ou numa nova
    // tentativa depois de uma falha de rede).
    const enviarCriacao = !task.imagemCriacaoEnviada && task.imagemCriacao && task.imagemCriacao.indexOf("data:") === 0;
    const enviarResolucao = !task.imagemResolucaoEnviada && task.imagemResolucao && task.imagemResolucao.indexOf("data:") === 0;
    const r = await postToSheet({
      tipo: "tarefa", id: task.id, listId: task.listId, texto: task.texto, status: task.status,
      criadoEm: task.criadoEm, resolvidoEm: task.resolvidoEm || "",
      imagemCriacaoBase64: enviarCriacao ? task.imagemCriacao : "",
      imagemResolucaoBase64: enviarResolucao ? task.imagemResolucao : ""
    });
    if (r.ok){
      task.sincronizado = true;
      if (enviarCriacao) task.imagemCriacaoEnviada = true;
      if (enviarResolucao) task.imagemResolucaoEnviada = true;
      await dbPut("tasks", task);
    }
    return r.ok;
  }

  async function syncAll(){
    const url = await getWebAppUrl();
    if (!url){ setSyncStatus("local"); return; }
    setSyncStatus("sincronizando");
    const [lists, tasks] = await Promise.all([dbGetAll("lists"), dbGetAll("tasks")]);
    let allOk = true;
    for (const l of lists.filter(l => !l.sincronizado)) { allOk = (await syncList(l)) && allOk; }
    for (const t of tasks.filter(t => !t.sincronizado)) { allOk = (await syncTask(t)) && allOk; }
    allOk = (await pushPendingDeletes()) && allOk;
    setSyncStatus(allOk ? "sincronizado" : "pendente");
    return allOk;
  }

  // Envia para a planilha as exclusões de lista feitas localmente (sem
  // restrição de data — excluir é uma ação explícita do usuário). Enquanto
  // não confirmado pelo servidor, o id continua na fila e a lista não volta
  // a aparecer localmente (veja o filtro em mergeRemoteData).
  async function pushPendingDeletes(){
    const url = await getWebAppUrl();
    if (!url) return true;
    const pendentes = await dbGetAll("pendingDeletes");
    let allOk = true;
    for (const p of pendentes){
      const tipoRemoto = p.tipo === "tarefa" ? "excluirTarefa" : "excluirLista";
      const r = await postToSheet({ tipo: tipoRemoto, id: p.id });
      if (r.ok) await dbDelete("pendingDeletes", p.id);
      else allOk = false;
    }
    return allOk;
  }

  // Busca o estado completo (todas as listas/tarefas) direto da planilha,
  // para que qualquer dispositivo enxergue o que foi feito nos outros.
  async function pullAll(){
    const url = await getWebAppUrl();
    if (!url) return false;
    try{
      const sep = url.indexOf("?") >= 0 ? "&" : "?";
      const res = await fetch(url + sep + "action=listarTudo");
      const data = await res.json();
      if (!data || !data.success) return false;
      await mergeRemoteData(data.listas || [], data.tarefas || []);
      return true;
    }catch(err){
      return false;
    }
  }

  // Mescla os dados vindos da planilha com o banco local. Nunca sobrescreve
  // uma lista/tarefa criada/editada localmente que ainda não foi enviada
  // (sincronizado:false) — ela será enviada e só então substituída pela
  // versão "oficial" na próxima sincronização.
  // Se uma lista já sincronizada sumiu da planilha (por exemplo, alguém
  // apagou a linha manualmente), ela NÃO é apagada sozinha — só fica
  // marcada como "ausente da planilha", e o usuário decide o que fazer.
  async function mergeRemoteData(listasRemotas, tarefasRemotas){
    const [listasLocais, tarefasLocais, pendentesExclusao] = await Promise.all([
      dbGetAll("lists"), dbGetAll("tasks"), dbGetAll("pendingDeletes")
    ]);
    const idsPendentesListaExclusao = new Set(pendentesExclusao.filter(p => p.tipo !== "tarefa").map(p => p.id));
    const idsPendentesTarefaExclusao = new Set(pendentesExclusao.filter(p => p.tipo === "tarefa").map(p => p.id));
    const mapaListas = new Map(listasLocais.map(l => [l.id, l]));
    const mapaTarefas = new Map(tarefasLocais.map(t => [t.id, t]));

    // Ignora, na planilha, o que já foi apagado localmente e ainda não
    // teve a exclusão confirmada no servidor — senão o pull traria de volta.
    const listasRemotasValidas = listasRemotas.filter(rl => !idsPendentesListaExclusao.has(rl.id));
    const tarefasRemotasValidas = tarefasRemotas.filter(rt =>
      !idsPendentesListaExclusao.has(rt.listId) && !idsPendentesTarefaExclusao.has(rt.id));

    for (const rl of listasRemotasValidas){
      const local = mapaListas.get(rl.id);
      if (!local || local.sincronizado){
        await dbPut("lists", {
          id: rl.id,
          nome: rl.nome || (local && local.nome) || "",
          criadoEm: rl.criadoEm || (local && local.criadoEm) || new Date().toISOString(),
          status: rl.status || (local && local.status) || "aberta",
          sincronizado: true,
          ausenteDaPlanilha: false
        });
      }
    }

    for (const rt of tarefasRemotasValidas){
      const local = mapaTarefas.get(rt.id);
      if (!local || local.sincronizado){
        await dbPut("tasks", {
          id: rt.id,
          listId: rt.listId,
          texto: rt.texto || (local && local.texto) || "",
          status: rt.status || (local && local.status) || "pendente",
          criadoEm: rt.criadoEm || (local && local.criadoEm) || new Date().toISOString(),
          resolvidoEm: rt.resolvidoEm || (local && local.resolvidoEm) || null,
          imagemCriacao: rt.fotoCriacaoId || (local && local.imagemCriacao) || null,
          imagemResolucao: rt.fotoResolucaoId || (local && local.imagemResolucao) || null,
          imagemCriacaoEnviada: !!rt.fotoCriacaoId || (local && local.imagemCriacaoEnviada) || false,
          imagemResolucaoEnviada: !!rt.fotoResolucaoId || (local && local.imagemResolucaoEnviada) || false,
          sincronizado: true
        });
      }
    }

    // Lista sincronizada que sumiu da planilha: só marca — quem decide se
    // sincroniza de novo ou exclui é o usuário.
    const idsListasRemotas = new Set(listasRemotas.map(l => l.id));
    for (const l of listasLocais){
      if (l.sincronizado && !l.ausenteDaPlanilha
          && !idsListasRemotas.has(l.id) && !idsPendentesListaExclusao.has(l.id)){
        await dbPut("lists", Object.assign({}, l, { ausenteDaPlanilha: true }));
      }
    }

    // Tarefa sincronizada, cuja lista continua na planilha, mas que sumiu da aba "Tarefas": foi excluída em outro dispositivo — aqui
    // pode remover direto, sem perguntar, porque a exclusão já passou por
    // confirmação em quem excluiu.
    const idsTarefasRemotas = new Set(tarefasRemotas.map(t => t.id));
    for (const t of tarefasLocais){
      if (t.sincronizado && idsListasRemotas.has(t.listId) && !idsTarefasRemotas.has(t.id)
          && !idsPendentesTarefaExclusao.has(t.id)){
        await dbDelete("tasks", t.id);
      }
    }
  }

  // Ciclo completo: envia o que está pendente e depois busca o estado global.
  // É isso que roda a cada 1 minuto e no botão "Sincronizar agora" (ou tocando no indicador de status, no topo).
  async function syncCycle(){
    const url = await getWebAppUrl();
    if (!url){ setSyncStatus("local"); return; }
    if (!navigator.onLine){ setSyncStatus("offline"); return; }
    setSyncStatus("sincronizando");
    await syncAll();
    const pullOk = await pullAll();
    setSyncStatus(pullOk ? "sincronizado" : "pendente");
    refreshCurrentView();
  }

  function setSyncStatus(status){
    const pill = document.getElementById("syncPill");
    const dot = document.getElementById("syncDot");
    const label = document.getElementById("syncLabel");
    dot.className = "dot";
    pill.classList.toggle("sincronizando", status === "sincronizando");
    if (status === "sincronizado"){ dot.classList.add("ok"); label.textContent = "sincronizado"; }
    else if (status === "sincronizando"){ label.textContent = "sincronizando…"; }
    else if (status === "pendente"){ dot.classList.add("pending"); label.textContent = "pendente"; }
    else if (status === "local"){ label.textContent = "somente local"; }
    else if (status === "offline"){ dot.classList.add("off"); label.textContent = "offline"; }
  }

  /* ============================================================
     NAVEGAÇÃO
     ============================================================ */
  const views = ["menu","create","resolve-select","resolve-task","list-detail","settings"];
  let currentView = "menu";
  function showView(name){
    currentView = name;
    views.forEach(v => {
      document.getElementById("view-" + v).hidden = (v !== name);
    });
    if (name === "menu") renderMenu();
    if (name === "resolve-select") renderResolveSelect();
    if (name === "list-detail") renderListDetail();
    if (name === "settings") renderSettings();
  }
  // Reaplica os dados na tela atual depois de uma sincronização automática,
  // sem tirar o usuário do que ele está fazendo.
  function refreshCurrentView(){
    if (currentView === "menu") renderMenu();
    else if (currentView === "resolve-select") renderResolveSelect();
    else if (currentView === "list-detail") renderListDetail();
  }
  document.querySelectorAll("[data-nav]").forEach(btn => {
    btn.addEventListener("click", () => showView(btn.getAttribute("data-nav")));
  });
  document.getElementById("tileCreate").addEventListener("click", () => startCreate());
  document.getElementById("tileSolve").addEventListener("click", () => showView("resolve-select"));
  document.getElementById("btnSettings").addEventListener("click", () => showView("settings"));

  function toast(msg){
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._h);
    toast._h = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // Toque em qualquer foto de tarefa (registro, confirmação, ou prévia
  // durante a resolução) abre ela ampliada, com um X para fechar.
  function openLightbox(src){
    if (!src) return;
    document.getElementById("lightboxImg").src = src;
    document.getElementById("lightbox").hidden = false;
  }
  function closeLightbox(){
    document.getElementById("lightbox").hidden = true;
    document.getElementById("lightboxImg").src = "";
  }
  document.getElementById("lightboxClose").addEventListener("click", closeLightbox);
  document.getElementById("lightbox").addEventListener("click", (e) => {
    if (e.target.id === "lightbox") closeLightbox();
  });
  document.body.addEventListener("click", (e) => {
    const img = e.target.closest(".dt-img-col img, .task-card .ref-image, .confirm-zone img");
    if (img && img.getAttribute("src")) openLightbox(img.src);
  });

  function fmtData(iso){
    try{
      const d = new Date(iso);
      return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", {hour:"2-digit", minute:"2-digit"});
    }catch(_){ return iso; }
  }

  /* ============================================================
     TELA: MENU — lista de listas existentes
     ============================================================ */
  async function renderMenu(){
    const isAdmin = sessaoAtual && sessaoAtual.papel === "admin";
    document.getElementById("menuLead").textContent = isAdmin
      ? "Crie uma lista de tarefas com fotos, ou resolva pendências registrando a foto de confirmação. Tudo é compartilhado — visível para todos, em qualquer dispositivo."
      : "Resolva pendências registrando a foto de confirmação, ou exporte uma lista em PDF.";
    const container = document.getElementById("listsContainer");
    const lists = await dbGetAll("lists");
    if (!lists.length){
      container.innerHTML = '<div class="empty">Nenhuma lista ainda. Toque em "Criar lista de tarefas" para começar.</div>';
      return;
    }
    lists.sort((a,b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
    const rows = await Promise.all(lists.map(async l => {
      const tasks = await dbGetAllByIndex("tasks", "listId", l.id);
      const total = tasks.length;
      const resolvidas = tasks.filter(t => t.status === "resolvida").length;
      const semSync = !l.sincronizado || tasks.some(t => !t.sincronizado);
      const avisoAusente = l.ausenteDaPlanilha ? '<span class="status-badge ausente">local</span>' : "";
      const avisoVazia = (!l.ausenteDaPlanilha && total === 0) ? '<span class="status-badge vazia">vazia</span>' : "";
      return `
        <div class="list-row status-${l.status}${l.ausenteDaPlanilha ? " ausente" : ""}" data-list-id="${l.id}">
          <div class="info">
            <div class="name">${escapeHtml(l.nome)}</div>
            <div class="meta">${fmtData(l.criadoEm)}</div>
          </div>
          ${avisoVazia}
          ${avisoAusente}
          <span class="count">${resolvidas}/${total}</span>
          <span class="dot sync-dot ${semSync ? "pending" : "ok"}" title="${semSync ? "aguardando sincronização" : "sincronizado"}"></span>
        </div>`;
    }));
    container.innerHTML = rows.join("");
    container.querySelectorAll(".list-row").forEach(row => {
      row.addEventListener("click", () => openListDetail(row.getAttribute("data-list-id")));
    });
  }

  function escapeHtml(str){
    const d = document.createElement("div");
    d.textContent = str == null ? "" : str;
    return d.innerHTML;
  }

  /* ============================================================
     TELA: CRIAR LISTA DE TAREFAS
     ============================================================ */
  let stagedTasks = [];
  let pendingShot = null; // dataURL da foto selecionada, aguardando "Adicionar tarefa"

  function startCreate(){
    if (!sessaoAtual || sessaoAtual.papel !== "admin"){ toast("Sem permissão para criar listas."); return; }
    stagedTasks = [];
    pendingShot = null;
    document.getElementById("listName").value = "";
    document.getElementById("taskText").value = "";
    resetShotTrigger();
    renderStaged();
    showView("create");
  }

  function resetShotTrigger(){
    const trigger = document.getElementById("createShotTrigger");
    trigger.classList.remove("has-image");
    trigger.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
      <span id="createShotLabel">Tirar ou anexar uma foto</span>
      <input class="shot-input" type="file" accept="image/*" capture="environment" id="createShotInput">`;
    document.getElementById("createShotInput").addEventListener("change", onCreateShotChosen);
  }

  document.getElementById("createShotInput").addEventListener("change", onCreateShotChosen);

  async function onCreateShotChosen(e){
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = await fileToCompressedDataURL(file);
    pendingShot = dataUrl;
    const trigger = document.getElementById("createShotTrigger");
    trigger.classList.add("has-image");
    trigger.innerHTML = `<img src="${dataUrl}" alt="Prévia da foto"><input class="shot-input" type="file" accept="image/*" capture="environment" id="createShotInput">`;
    document.getElementById("createShotInput").addEventListener("change", onCreateShotChosen);
  }

  document.getElementById("btnAddTask").addEventListener("click", () => {
    const texto = document.getElementById("taskText").value.trim();
    if (!pendingShot){ toast("Adicione uma foto para a tarefa."); return; }
    if (!texto){ toast("Descreva do que se trata."); return; }
    stagedTasks.push({ id: uuid(), texto, imagem: pendingShot });
    pendingShot = null;
    document.getElementById("taskText").value = "";
    resetShotTrigger();
    renderStaged();
  });

  function renderStaged(){
    const c = document.getElementById("stagedContainer");
    if (!stagedTasks.length){ c.innerHTML = ""; }
    else {
      c.innerHTML = `<div class="section-label">TAREFAS NESTA LISTA (${stagedTasks.length})</div>` +
        stagedTasks.map(t => `
          <div class="staged-task" data-id="${t.id}">
            <img src="${t.imagem}" alt="">
            <div class="txt">${escapeHtml(t.texto)}</div>
            <button class="rm" data-id="${t.id}" aria-label="Remover">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>`).join("");
      c.querySelectorAll(".rm").forEach(btn => {
        btn.addEventListener("click", () => {
          stagedTasks = stagedTasks.filter(t => t.id !== btn.getAttribute("data-id"));
          renderStaged();
        });
      });
    }
    document.getElementById("btnSaveList").disabled = stagedTasks.length === 0 || !document.getElementById("listName").value.trim();
  }
  document.getElementById("listName").addEventListener("input", renderStaged);

  document.getElementById("btnSaveList").addEventListener("click", async () => {
    const nome = document.getElementById("listName").value.trim();
    if (!nome || !stagedTasks.length) return;
    const btn = document.getElementById("btnSaveList");
    btn.disabled = true;
    btn.textContent = "Salvando…";

    const now = new Date().toISOString();
    const listId = uuid();
    const list = { id: listId, nome, criadoEm: now, status: "aberta", sincronizado: false };
    await dbPut("lists", list);
    for (const t of stagedTasks){
      await dbPut("tasks", {
        id: t.id, listId, texto: t.texto, imagemCriacao: t.imagem, imagemResolucao: null,
        status: "pendente", criadoEm: now, resolvidoEm: null, sincronizado: false,
        imagemCriacaoEnviada: false, imagemResolucaoEnviada: false
      });
    }
    toast(`Lista salva com ${stagedTasks.length} tarefa(s).`);
    syncAll();
    btn.textContent = "Salvar lista";
    showView("menu");
  });

  /* ============================================================
     TELA: ESCOLHER LISTA PARA RESOLVER
     ============================================================ */
  async function renderResolveSelect(){
    const container = document.getElementById("resolveListsContainer");
    const lists = await dbGetAll("lists");
    const abertas = lists.filter(l => l.status === "aberta");
    if (!abertas.length){
      container.innerHTML = '<div class="empty">Nenhuma lista pendente. Crie uma nova lista de tarefas primeiro.</div>';
      return;
    }
    const rows = await Promise.all(abertas.map(async l => {
      const tasks = await dbGetAllByIndex("tasks", "listId", l.id);
      const total = tasks.length;
      const resolvidas = tasks.filter(t => t.status === "resolvida").length;
      return `
        <div class="list-row status-aberta" data-list-id="${l.id}">
          <div class="info">
            <div class="name">${escapeHtml(l.nome)}</div>
            <div class="meta">${fmtData(l.criadoEm)}</div>
          </div>
          <span class="count">${resolvidas}/${total}</span>
        </div>`;
    }));
    container.innerHTML = rows.join("");
    container.querySelectorAll(".list-row").forEach(row => {
      row.addEventListener("click", () => startResolve(row.getAttribute("data-list-id")));
    });
  }

  /* ============================================================
     TELA: RESOLVER TAREFA — navegação livre entre as pendentes,
     sem precisar seguir a ordem
     ============================================================ */
  let resolveState = { listId: null, queue: [], index: 0 };

  async function startResolve(listId){
    const list = await dbGet("lists", listId);
    const tasks = await dbGetAllByIndex("tasks", "listId", listId);
    const pendentes = tasks.filter(t => t.status === "pendente");
    document.getElementById("resolveListName").textContent = list.nome;
    if (!pendentes.length){
      await finalizeList(listId);
      toast("Essa lista já está totalmente resolvida.");
      showView("menu");
      return;
    }
    resolveState = { listId, queue: pendentes, index: 0 };
    showView("resolve-task");
    renderResolveTask();
  }

  function renderResolveNav(){
    const nav = document.getElementById("resolveNav");
    nav.innerHTML = resolveState.queue.map((t, i) => {
      const classes = ["resolve-chip"];
      if (i === resolveState.index) classes.push("atual");
      return `<button class="${classes.join(" ")}" data-index="${i}">${i + 1}</button>`;
    }).join("");
  }
  document.getElementById("resolveNav").addEventListener("click", (e) => {
    const btn = e.target.closest(".resolve-chip");
    if (!btn) return;
    resolveState.index = parseInt(btn.getAttribute("data-index"), 10);
    renderResolveTask();
  });

  function renderResolveTask(){
    const body = document.getElementById("resolveTaskBody");
    const nav = document.getElementById("resolveNav");

    if (!resolveState.queue.length){
      nav.hidden = true;
      body.innerHTML = `
        <div class="done-screen">
          <div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12l2.5 2.5L16 9"/></svg></div>
          <h2>Lista concluída</h2>
          <p class="lead">Todas as tarefas foram resolvidas e fotografadas.</p>
          <button class="btn btn-primary" id="btnBackToMenu">Voltar ao menu</button>
        </div>`;
      document.getElementById("btnBackToMenu").addEventListener("click", () => showView("menu"));
      return;
    }

    nav.hidden = false;
    renderResolveNav();
    const task = resolveState.queue[resolveState.index];
    body.innerHTML = `
      <div class="progress-line">${resolveState.queue.length} pendente(s) · toque em um número acima para pular direto para ela</div>
      <div class="task-card">
        <img class="ref-image" data-src="${escapeHtml(task.imagemCriacao || "")}" alt="Foto da tarefa">
        <div class="ref-body">
          <div class="ref-tag">REGISTRADO EM ${fmtData(task.criadoEm)}</div>
          <div class="ref-text">${escapeHtml(task.texto)}</div>
        </div>
      </div>
      <div class="section-label">FOTO DE CONFIRMAÇÃO</div>
      <div class="confirm-zone" id="confirmZone">
        <div class="cz-label">Fotografe o resultado para confirmar que foi resolvido</div>
        <label class="btn btn-ghost" style="display:inline-flex;">
          Tirar foto de confirmação
          <input type="file" accept="image/*" capture="environment" id="resolveShotInput" style="display:none;">
        </label>
      </div>
      <button class="btn btn-success" id="btnConfirmTask" disabled>Confirmar resolução</button>`;

    hydrateImages(body);

    let confirmShot = null;
    document.getElementById("resolveShotInput").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      confirmShot = await fileToCompressedDataURL(file);
      document.getElementById("confirmZone").innerHTML = `
        <img src="${confirmShot}" alt="Foto de confirmação">
        <label class="btn btn-ghost" style="display:inline-flex;">
          Tirar outra foto
          <input type="file" accept="image/*" capture="environment" id="resolveShotInput2" style="display:none;">
        </label>`;
      document.getElementById("resolveShotInput2").addEventListener("change", async (ev) => {
        const f = ev.target.files[0];
        if (!f) return;
        confirmShot = await fileToCompressedDataURL(f);
        document.querySelector("#confirmZone img").src = confirmShot;
      });
      document.getElementById("btnConfirmTask").disabled = false;
    });

    document.getElementById("btnConfirmTask").addEventListener("click", async () => {
      if (!confirmShot) return;
      const btn = document.getElementById("btnConfirmTask");
      btn.disabled = true;
      btn.textContent = "Confirmando…";
      const now = new Date().toISOString();
      task.status = "resolvida";
      task.imagemResolucao = confirmShot;
      task.imagemResolucaoEnviada = false; // é uma foto nova — força reenvio mesmo se já tinha sido resolvida antes
      task.resolvidoEm = now;
      task.sincronizado = false;
      await dbPut("tasks", task);
      syncTask(task).then(() => renderMenu());

      // Sai da fila assim que a foto é enviada — não fica mais selecionável aqui.
      resolveState.queue.splice(resolveState.index, 1);
      if (resolveState.index >= resolveState.queue.length){
        resolveState.index = Math.max(0, resolveState.queue.length - 1);
      }
      if (!resolveState.queue.length){
        await finalizeList(resolveState.listId);
      }
      renderResolveTask();
    });
  }

  async function finalizeList(listId){
    const list = await dbGet("lists", listId);
    const tasks = await dbGetAllByIndex("tasks", "listId", listId);
    const aindaPendente = tasks.some(t => t.status !== "resolvida");
    if (!aindaPendente){
      list.status = "concluida";
      list.sincronizado = false;
      await dbPut("lists", list);
      syncList(list);
    }
  }

  /* ============================================================
     TELA: DETALHE DA LISTA
     Ver todas as imagens (mesmo de listas já concluídas) e
     adicionar uma nova tarefa a uma lista já existente.
     ============================================================ */
  let currentDetailListId = null;
  let detailAddShot = null;

  function openListDetail(listId){
    currentDetailListId = listId;
    showView("list-detail");
  }

  async function renderListDetail(){
    const listId = currentDetailListId;
    const list = await dbGet("lists", listId);
    if (!list){ showView("menu"); return; }
    const tasks = await dbGetAllByIndex("tasks", "listId", listId);
    tasks.sort((a,b) => (a.criadoEm || "").localeCompare(b.criadoEm || ""));
    const pendentes = tasks.filter(t => t.status === "pendente").length;
    const resolvidas = tasks.length - pendentes;

    document.getElementById("detailListName").textContent = list.nome;
    document.getElementById("detailListMeta").textContent = `${fmtData(list.criadoEm)} · ${resolvidas}/${tasks.length} resolvidas`;
    const badge = document.getElementById("detailListStatus");
    badge.textContent = list.status === "concluida" ? "concluída" : "aberta";
    badge.className = "status-badge " + list.status;

    const listaAusente = !!list.ausenteDaPlanilha;
    const listaVazia = !listaAusente && tasks.length === 0;
    document.getElementById("detailAusenteBanner").hidden = !listaAusente;
    document.getElementById("detailVaziaBanner").hidden = !listaVazia;

    // Quando um dos avisos acima já mostra seu próprio botão de excluir,
    // esconde o botão fixo do rodapé para não duplicar a opção na tela.
    document.getElementById("btnDetailDelete").hidden = listaAusente || listaVazia;

    const resolveBtn = document.getElementById("btnDetailResolve");
    resolveBtn.hidden = pendentes === 0;
    resolveBtn.textContent = `Resolver pendências (${pendentes})`;

    const tasksContainer = document.getElementById("detailTasksContainer");
    if (!tasks.length){
      tasksContainer.innerHTML = '<div class="empty">Nenhuma tarefa nesta lista ainda.</div>';
    } else {
      tasksContainer.innerHTML = tasks.map(t => {
        const resolvida = t.status === "resolvida";
        const images = (resolvida && t.imagemResolucao)
          ? `<div class="dt-images">
               <div class="dt-img-col"><span class="dt-img-label">Registro</span><img data-src="${escapeHtml(t.imagemCriacao || "")}" alt="Foto de registro"></div>
               <div class="dt-img-col"><span class="dt-img-label">Confirmação</span><img data-src="${escapeHtml(t.imagemResolucao)}" alt="Foto de confirmação"></div>
             </div>`
          : `<div class="dt-images"><div class="dt-img-col"><img data-src="${escapeHtml(t.imagemCriacao || "")}" alt="Foto de registro"></div></div>`;
        const quando = resolvida ? ("resolvida em " + fmtData(t.resolvidoEm)) : ("criada em " + fmtData(t.criadoEm));
        return `
          <div class="detail-task">
            ${images}
            <button class="dt-delete" data-task-id="${t.id}" aria-label="Excluir tarefa">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>
            </button>
            <div class="dt-body">
              <div class="dt-text">${escapeHtml(t.texto)}</div>
              <div class="dt-meta">
                <span class="status-badge ${t.status}">${resolvida ? "resolvida" : "pendente"}</span>
                <span class="when">${quando}</span>
              </div>
            </div>
          </div>`;
      }).join("");
      hydrateImages(tasksContainer);
    }

    document.getElementById("detailAddComposer").hidden = true;
    document.getElementById("detailAddText").value = "";
    resetDetailAddShot();
  }

  document.getElementById("btnDetailResolve").addEventListener("click", () => {
    if (currentDetailListId) startResolve(currentDetailListId);
  });
  document.getElementById("btnDetailAddTask").addEventListener("click", () => {
    document.getElementById("detailAddComposer").hidden = false;
  });
  document.getElementById("btnDetailAddCancel").addEventListener("click", () => {
    document.getElementById("detailAddComposer").hidden = true;
    document.getElementById("detailAddText").value = "";
    detailAddShot = null;
    resetDetailAddShot();
  });

  function resetDetailAddShot(){
    detailAddShot = null;
    const trigger = document.getElementById("detailAddShotTrigger");
    trigger.classList.remove("has-image");
    trigger.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
      <span>Tirar ou anexar uma foto</span>
      <input class="shot-input" type="file" accept="image/*" capture="environment" id="detailAddShotInput">`;
    document.getElementById("detailAddShotInput").addEventListener("change", onDetailAddShotChosen);
  }

  async function onDetailAddShotChosen(e){
    const file = e.target.files[0];
    if (!file) return;
    detailAddShot = await fileToCompressedDataURL(file);
    const trigger = document.getElementById("detailAddShotTrigger");
    trigger.classList.add("has-image");
    trigger.innerHTML = `<img src="${detailAddShot}" alt="Prévia da foto"><input class="shot-input" type="file" accept="image/*" capture="environment" id="detailAddShotInput">`;
    document.getElementById("detailAddShotInput").addEventListener("change", onDetailAddShotChosen);
  }

  document.getElementById("btnDetailAddSave").addEventListener("click", async () => {
    const texto = document.getElementById("detailAddText").value.trim();
    if (!detailAddShot){ toast("Adicione uma foto para a tarefa."); return; }
    if (!texto){ toast("Descreva do que se trata."); return; }
    const btn = document.getElementById("btnDetailAddSave");
    btn.disabled = true;

    const now = new Date().toISOString();
    const task = {
      id: uuid(), listId: currentDetailListId, texto, imagemCriacao: detailAddShot,
      imagemResolucao: null, status: "pendente", criadoEm: now, resolvidoEm: null, sincronizado: false,
      imagemCriacaoEnviada: false, imagemResolucaoEnviada: false
    };
    await dbPut("tasks", task);
    syncTask(task);

    const list = await dbGet("lists", currentDetailListId);
    if (list && list.status === "concluida"){
      list.status = "aberta";
      list.sincronizado = false;
      await dbPut("lists", list);
      syncList(list);
    }

    toast("Tarefa adicionada.");
    btn.disabled = false;
    renderListDetail();
  });

  // Compartilhada pelo botão "Excluir lista" (rodapé) e pelo botão "Excluir"
  // do aviso de lista ausente da planilha.
  async function excluirListaAtual(){
    if (!sessaoAtual || sessaoAtual.papel !== "admin"){ toast("Sem permissão para excluir."); return; }
    const listId = currentDetailListId;
    const list = await dbGet("lists", listId);
    if (!list) return;
    const confirmado = confirm(`Excluir a lista "${list.nome}"? Ela e suas tarefas somem deste dispositivo e da planilha, para todo mundo.`);
    if (!confirmado) return;

    const tarefas = await dbGetAllByIndex("tasks", "listId", listId);
    for (const t of tarefas) await dbDelete("tasks", t.id);
    await dbDelete("lists", listId);
    await dbPut("pendingDeletes", { id: listId, tipo: "lista" });

    toast("Lista excluída.");
    showView("menu");
    pushPendingDeletes();
  }
  document.getElementById("btnDetailDelete").addEventListener("click", excluirListaAtual);
  document.getElementById("btnDetailDeleteFromBanner").addEventListener("click", excluirListaAtual);
  document.getElementById("btnDetailDeleteEmpty").addEventListener("click", excluirListaAtual);

  // Excluir uma tarefa específica de dentro da lista (ícone no canto da foto).
  async function excluirTarefa(taskId){
    if (!sessaoAtual || sessaoAtual.papel !== "admin"){ toast("Sem permissão para excluir."); return; }
    const task = await dbGet("tasks", taskId);
    if (!task) return;
    const confirmado = confirm("Excluir esta tarefa? Ela some deste dispositivo e da planilha, para todo mundo.");
    if (!confirmado) return;

    await dbDelete("tasks", taskId);
    await dbPut("pendingDeletes", { id: taskId, tipo: "tarefa" });
    await finalizeList(task.listId); // se não sobrou pendência, a lista fecha sozinha

    toast("Tarefa excluída.");
    renderListDetail();
    pushPendingDeletes();
  }
  document.getElementById("detailTasksContainer").addEventListener("click", (e) => {
    const btn = e.target.closest(".dt-delete");
    if (btn) excluirTarefa(btn.getAttribute("data-task-id"));
  });

  /* ============================================================
     EXPORTAR LISTA PARA PDF (via impressão do navegador)
     Monta um documento só de leitura — com a foto de registro de
     cada tarefa, nunca a de resolução — e abre o diálogo de
     impressão, onde dá para escolher "Salvar como PDF".
     ============================================================ */
  async function exportarPDF(somentePendentes){
    const list = await dbGet("lists", currentDetailListId);
    if (!list) return;
    const todas = await dbGetAllByIndex("tasks", "listId", currentDetailListId);
    todas.sort((a,b) => (a.criadoEm || "").localeCompare(b.criadoEm || ""));
    const tarefas = somentePendentes ? todas.filter(t => t.status === "pendente") : todas;

    if (!tarefas.length){
      toast(somentePendentes ? "Não há tarefas pendentes para exportar." : "Esta lista não tem tarefas.");
      return;
    }

    toast("Preparando PDF…");
    const imagens = await Promise.all(tarefas.map(t => resolveImageSrc(t.imagemCriacao)));

    const agora = new Date();
    const dataExport = agora.toLocaleDateString("pt-BR") + " " + agora.toLocaleTimeString("pt-BR", {hour:"2-digit", minute:"2-digit"});

    const corpo = tarefas.map((t, i) => {
      const foto = imagens[i]
        ? `<img class="print-task-img" src="${imagens[i]}" alt="">`
        : `<div class="print-task-img print-task-img-empty">Sem foto</div>`;
      return `
        <div class="print-task">
          <div class="print-task-head">
            <span class="print-task-num">Tarefa ${i + 1}</span>
            <span class="print-task-status">${t.status === "resolvida" ? "Resolvida" : "Pendente"}</span>
          </div>
          ${foto}
          <div class="print-task-text">${escapeHtml(t.texto)}</div>
        </div>`;
    }).join("");

    document.getElementById("printSheet").innerHTML = `
      <div class="print-header">
        <h1>${escapeHtml(list.nome)}</h1>
        <div class="print-meta">${somentePendentes ? "Tarefas pendentes" : "Todas as tarefas"} · ${tarefas.length} tarefa(s) · exportado em ${dataExport}</div>
      </div>
      <div class="print-tasks">${corpo}</div>`;

    // pequena espera para as imagens (já em base64) terminarem de renderizar
    // antes do diálogo de impressão abrir.
    setTimeout(() => window.print(), 250);
  }
  document.getElementById("btnExportAll").addEventListener("click", () => exportarPDF(false));
  document.getElementById("btnExportPending").addEventListener("click", () => exportarPDF(true));

  // Reenvia para a planilha uma lista marcada como "ausente" — recria a
  // linha dela e das tarefas, como se fosse uma sincronização nova.
  document.getElementById("btnDetailResync").addEventListener("click", async () => {
    const listId = currentDetailListId;
    const list = await dbGet("lists", listId);
    if (!list) return;
    const btn = document.getElementById("btnDetailResync");
    btn.disabled = true;
    btn.textContent = "Sincronizando…";

    list.sincronizado = false;
    list.ausenteDaPlanilha = false;
    await dbPut("lists", list);
    const tarefas = await dbGetAllByIndex("tasks", "listId", listId);
    for (const t of tarefas){
      // Se a imagem já tinha virado só um ID do Drive (não é mais o base64
      // original), busca no cache local para conseguir reenviar de verdade.
      if (t.imagemCriacao && t.imagemCriacao.indexOf("data:") !== 0){
        const cache = await dbGet("imageCache", t.imagemCriacao);
        if (cache) t.imagemCriacao = cache.dataUri;
      }
      if (t.imagemResolucao && t.imagemResolucao.indexOf("data:") !== 0){
        const cache = await dbGet("imageCache", t.imagemResolucao);
        if (cache) t.imagemResolucao = cache.dataUri;
      }
      t.sincronizado = false;
      t.imagemCriacaoEnviada = false;
      t.imagemResolucaoEnviada = false;
      await dbPut("tasks", t);
    }

    await syncAll();
    toast("Lista sincronizada com a planilha novamente.");
    btn.disabled = false;
    btn.textContent = "Sincronizar";
    renderListDetail();
  });

  /* ============================================================
     TELA: CONFIGURAÇÕES
     ============================================================ */
  async function renderSettings(){
    const url = await getWebAppUrl();
    const input = document.getElementById("webAppUrl");
    const saveBtn = document.getElementById("btnSaveUrl");
    const note = document.getElementById("settingsNote");
    input.value = url;
    const isAdmin = sessaoAtual && sessaoAtual.papel === "admin";
    if (!isAdmin) {
      // Perfil sem permissão para mexer na sincronização.
      input.disabled = true;
      saveBtn.hidden = true;
      note.textContent = "Você não tem permissão para alterar a URL de sincronização.";
    } else if (WEB_APP_URL) {
      // URL fixada no código do app — não editável por aqui.
      input.disabled = true;
      saveBtn.hidden = true;
      note.textContent = "Este app já está conectado à planilha (a URL foi definida diretamente no código pelo responsável pelo app). Não é preciso configurar nada aqui.";
    } else {
      input.disabled = false;
      saveBtn.hidden = false;
      note.textContent = 'Cole aqui a URL gerada ao publicar o script como "App da Web" (veja o arquivo LEIAME-configuracao.md). Os dados ficam salvos neste dispositivo mesmo sem essa URL — a sincronização com a planilha é feita quando ela estiver configurada e houver conexão.';
    }
    document.getElementById("settingsUserNote").textContent = sessaoAtual
      ? `Conectado como ${sessaoAtual.usuario} (${isAdmin ? "administrativo" : "comum"}).`
      : "";
  }
  document.getElementById("btnSaveUrl").addEventListener("click", async () => {
    if (!sessaoAtual || sessaoAtual.papel !== "admin"){ toast("Sem permissão para alterar a sincronização."); return; }
    const url = document.getElementById("webAppUrl").value.trim();
    await dbPut("config", { key: "webAppUrl", value: url });
    toast(url ? "URL salva." : "URL removida.");
    syncCycle();
  });
  document.getElementById("btnSyncNow").addEventListener("click", () => {
    toast("Sincronizando…");
    syncCycle().then(() => { toast("Sincronização concluída."); refreshCurrentView(); });
  });

  // Indicador de status no topo — visível em qualquer tela — também serve
  // como atalho para sincronizar na hora, já que a sincronização automática
  // passou a rodar com menos frequência.
  document.getElementById("syncPill").addEventListener("click", () => {
    syncCycle().then(() => refreshCurrentView());
  });

  /* ============================================================
     STATUS DE CONEXÃO + SINCRONIZAÇÃO AUTOMÁTICA + INICIALIZAÇÃO
     ============================================================ */
  window.addEventListener("online", () => syncCycle());
  window.addEventListener("offline", () => setSyncStatus("offline"));

  // Sincronização automática a cada 1 minuto: envia pendências e busca
  // o estado global mais recente, para que todos os dispositivos
  // enxerguem as mesmas listas.
  setInterval(() => { if (navigator.onLine) syncCycle(); }, 60000);

  (async function init(){
    await getDB();
    const sessaoSalva = await getSessaoSalva();
    if (sessaoSalva && USUARIOS[sessaoSalva.usuario]){
      sessaoAtual = sessaoSalva;
      entrarNoApp();
    } else {
      document.getElementById("loginScreen").hidden = false;
      document.getElementById("app").hidden = true;
    }
  })();

})();
