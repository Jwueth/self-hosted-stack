
# Instagram Screenshot Automation (n8n + Playwright + Firefox)

## Objectif

Automatiser la capture de screenshots de profils Instagram (photo, bio, stats, + 6 premiers posts)  
en utilisant une **session persistante** pour éviter les problèmes de login, cookies et captcha.

Ce système est conçu pour fonctionner **en local / self-hosted**, avec :

- n8n (orchestration)
- Firefox (session Instagram persistante via VNC)
- Playwright (screenshots headless)
- Docker

---

## Architecture

### Conteneurs utilisés

| Service | Rôle |
|--------|------|
| `chrome_vnc` | Navigateur graphique (Firefox) pour se connecter une fois à Instagram |
| `pw_runner` | Playwright headless pour générer les screenshots |
| `n8n` | Orchestration (Excel → boucle → screenshots → upload) |

### Dossiers importants

```

/home/YOUR_USER/docker/ig-profile/
├─ docker-compose.yml
├─ ig-profile/
│  └─ firefox-profile/   ← session Instagram persistante
└─ work/
├─ ig_shot.js         ← script Playwright
└─ out/               ← screenshots générés

````

---

## Étape 1 — Créer la session Instagram persistante

1. Lancer le conteneur VNC :

```bash
docker compose up -d chrome_vnc
````

2. Ouvrir dans le navigateur :

```
http://localhost:7900
```

3. Ouvrir **Firefox**
4. Aller sur `https://www.instagram.com`
5. Se connecter avec le **compte spécial**
6. Accepter les cookies

### Forcer Firefox à utiliser le bon profil

Dans le terminal du VNC :

```bash
mkdir -p /home/ubuntu/firefox-profile
firefox -profile /home/ubuntu/firefox-profile
```

Se connecter à Instagram dans cette fenêtre.

### Vérification

Dans WSL / terminal :

```bash
ls -la /home/YOUR_USER/docker/ig-profile/ig-profile/firefox-profile
```

Si tu vois des fichiers → la session est bien stockée.

---

## Étape 2 — Lancer Playwright headless

### Service `pw_runner`

```yaml
pw_runner:
  image: mcr.microsoft.com/playwright:v1.57.0-jammy
  container_name: pw_runner
  restart: unless-stopped
  working_dir: /work
  volumes:
    - ./ig-profile:/ig-profile
    - ./work:/work
  entrypoint: ["bash","-lc","sleep infinity"]
```

Lancer :

```bash
docker compose up -d pw_runner
```

---

## Étape 3 — Script de screenshot

Fichier : `work/ig_shot.js`

```js
const { firefox } = require("playwright");

(async () => {
  const url = process.argv[2];
  const out = process.argv[3] || "/work/out.png";
  if (!url) throw new Error("Missing url");

  const context = await firefox.launchPersistentContext(
    "/ig-profile/firefox-profile",
    {
      headless: true,
      viewport: { width: 1280, height: 2200 },
    }
  );

  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(1500);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  const postSel = 'a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]';

  for (let i = 0; i < 6; i++) {
    const count = await page.locator(postSel).count().catch(() => 0);
    if (count >= 6) break;
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(900);
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);

  const clip = await page.evaluate((postSel) => {
    const mainEl = document.querySelector("main");
    const posts = Array.from(document.querySelectorAll(postSel));
    const sixth = posts[5];
    if (!mainEl) return null;

    const mainRect = mainEl.getBoundingClientRect();
    const y = Math.max(0, mainRect.top + window.scrollY);

    let bottom = mainRect.bottom + window.scrollY;
    if (sixth) {
      const r = sixth.getBoundingClientRect();
      bottom = r.bottom + window.scrollY;
    }
    bottom += 20;

    return {
      x: 0,
      y,
      width: Math.floor(window.innerWidth),
      height: Math.max(200, Math.floor(bottom - y)),
    };
  }, postSel);

  if (clip) await page.screenshot({ path: out, clip });
  else await page.screenshot({ path: out, fullPage: false });

  await context.close();
})();
```

---

## Étape 4 — Tester un screenshot

```bash
mkdir -p /home/YOUR_USER/docker/ig-profile/work/out

docker exec -it pw_runner node /work/ig_shot.js \
"https://www.instagram.com/example_profile/" \
"/work/out/example_profile.png"
```

Image générée :

```
/home/YOUR_USER/docker/ig-profile/work/out/example_profile.png
```

---

## Bonnes pratiques

### Fréquence des screenshots

Éviter :

* 500 profils en 5 minutes

Préférer :

* 1 toutes les 5–10 secondes
* Batch de 100 → pause

### Éviter l’invalidation de session

Ne pas :

* Changer souvent d’IP
* Se connecter au même compte ailleurs
* Supprimer le dossier `ig-profile`

### Quand faut-il se reconnecter ?

Tu dois repasser par le VNC si :

* Instagram affiche la page de login
* Tu changes le mot de passe
* Tu supprimes `ig-profile`
* La session expire (rare, tous les 2–6 mois)

---

## Intégration n8n (exemple)

Node **Execute Command** :

```bash
docker exec pw_runner node /work/ig_shot.js \
"{{$json.url}}" \
"/work/out/{{$itemIndex}}.png"
```

Puis **Read Binary File** :

```
/work/out/{{$itemIndex}}.png
```

---

## Détection des profils privés (option)

On peut détecter :

* "This account is private"
* "Ce compte est privé"

Et marquer le statut dans Notion / NocoDB.

---

## Résumé

✔ Session Instagram persistante
✔ Pas de cookies à injecter
✔ Pas de login wall
✔ Compatible avec n8n
✔ Scalable (centaines de profils)

---

## Maintenance

| Action                 | Fréquence         |
| ---------------------- | ----------------- |
| Re-login Instagram     | Tous les 2–6 mois |
| Mise à jour Playwright | Occasionnelle     |
| Nettoyage `work/out`   | Selon besoin      |

---

## Auteur

Setup conçu pour automatisation locale, sans scraping agressif.
Usage responsable recommandé.

```

---

Si tu veux, je peux aussi :

- Te générer une **version PDF**
- Une version **Notion-ready**
- Ou une version **README GitHub stylée**  
- Ou un **diagramme d’architecture**

Dis-moi ce que tu veux pour la suite 👌
```
