# 今日のごはん相談

家にある食材を伝えると、大人2人＋4歳のお子さん1人分のレシピを提案してくれるチャット風アプリです。
Gemini APIを使ってレシピを生成し、作った日をカレンダーに記録できます。

家族限定での利用を想定した、シンプルな無料デプロイ構成になっています。

## 1. ローカルで動作確認する

```bash
npm install
npm run dev
```

表示されたURL（例: http://localhost:5173）を開き、画面上部の欄にGeminiのAPIキーを入力して動作を確認してください。
APIキーは [Google AI Studio](https://aistudio.google.com/apikey) から無料で取得できます。

## 2. GitHubにリポジトリを作る

```bash
git init
git add .
git commit -m "first commit"
```

GitHub上で新しいリポジトリを作成し（Public / Privateどちらでも可）、そのリポジトリにpushしてください。

```bash
git remote add origin https://github.com/【あなたのユーザー名】/【リポジトリ名】.git
git branch -M main
git push -u origin main
```

## 3. GitHub Pagesに公開する

```bash
npm run deploy
```

これで `dist` フォルダの内容が `gh-pages` ブランチにpushされます。
その後、GitHubリポジトリの **Settings → Pages** を開き、Source（公開元）が `gh-pages` ブランチになっていることを確認してください（`npm run deploy` を実行すると自動でこのブランチが作られます）。

数分後に、次のようなURLでアプリが公開されます。

```
https://【あなたのユーザー名】.github.io/【リポジトリ名】/
```

## 4. Gemini APIキーにドメイン制限をかける（重要）

1. [Google AI Studio](https://aistudio.google.com/apikey) を開く
2. 使用しているAPIキーの設定を開く
3. 「アプリケーションの制限」を **HTTPリファラー** にする
4. 上記で発行されたGitHub PagesのURL（`https://あなたのユーザー名.github.io/*`）を許可リストに追加する

こうしておくと、万が一URLを他人に知られても、他のサイトからそのキーを使ってGeminiにリクエストすることはできなくなります。

## 5. （任意）課金アカウントを紐付けない

Google Cloud側で請求先アカウントを紐付けないままにしておくと、万一悪用されても無料枠を超えた時点でエラーになるだけで、課金は発生しません。家族利用の範囲であれば無料枠内で十分収まります。

## 更新したいとき

コードを直したら、以下を実行するだけで再公開されます。

```bash
npm run deploy
```

## データについて

- レシピを「作った日」として記録した内容は、ブラウザの `localStorage` に保存されます。
- そのため、記録は使っているブラウザ・端末ごとに別々になります（家族それぞれの端末で見えるカレンダーは別のものになります）。同じ記録を家族で共有したい場合は、今後の拡張として外部データベース（Firebaseなど）との連携が必要です。
