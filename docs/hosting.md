# Hosting your own copy

About fifteen minutes, most of it waiting. No credit card, and no account
anywhere except Cloudflare.

## Before you start

- Node 24 or newer. Check with `node -v`.
- A Cloudflare account. The free one is enough.

## 1. Get the code

```bash
git clone https://github.com/MWH997/rag-in-the-box.git
cd rag-in-the-box
npm install
```

## 2. Create an API token

Cloudflare dashboard, **My Profile**, **API Tokens**, **Create Token**, then
**Create Custom Token**. Give it these permissions on your account:

| Permission         | Level | Why                                          |
| ------------------ | ----- | -------------------------------------------- |
| Workers Scripts    | Edit  | Deploy the Worker and set its secrets        |
| D1                 | Edit  | Create the database, apply migrations        |
| Vectorize          | Edit  | Create the index and its metadata index      |
| Workers AI         | Edit  | The model binding the Worker runs on         |
| Cloudflare Pages   | Edit  | Deploy the interface                         |
| Account Settings   | Read  | Confirm the token works before anything else |
| Workers R2 Storage | Edit  | Only if you set `R2_BUCKET_NAME`             |

Leave out R2 unless you want it. Nothing else needs it, and the deploy script
skips object storage entirely when `R2_BUCKET_NAME` is blank.

Copy the token when it is shown. It is not shown again.

Your account id is in the right hand column of any account page in the
dashboard.

If you would rather not create a token, leave `CLOUDFLARE_API_TOKEN` blank and
the deploy script will open a browser to sign you in instead.

## 3. Fill in the environment

```bash
cp .env.example .env
```

Open `.env` and set:

```
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
BETTER_AUTH_SECRET=...
ADMIN_TOKEN=...
```

Generate the two secrets:

```bash
node -e "console.log(crypto.randomUUID().replaceAll('-',''))"
```

Leave everything else alone for a first run. `.env` is ignored by git.

## 4. Deploy

```bash
./scripts/deploy.sh
```

It will:

1. Check your toolchain and credentials before changing anything.
2. Create the D1 database if it does not exist.
3. Create the Vectorize index and its metadata index if they do not exist.
4. Write a Worker configuration from your `.env`.
5. Apply the migrations.
6. Upload the secrets.
7. Deploy the Worker and the interface.
8. Print the URLs.

Run `./scripts/deploy.sh --dry-run` first if you want to see the plan without
touching your account.

Anything that already exists is left alone, so running it again after a change
is safe.

## 5. Point it at itself

The first run prints the two URLs Cloudflare gave you. Put them back into
`.env`:

```
API_ORIGIN=https://rag-in-the-box.your-subdomain.workers.dev
WEB_ORIGIN=https://rag-in-the-box.pages.dev
```

Then deploy once more. This matters: the interface needs to know where the API
is, and the API only accepts browser requests from the origin it is told about.

## 6. Open it

Go to your `WEB_ORIGIN`, create a workspace, and add a document. The file is
read in your browser, so a large PDF costs your machine a second or two and the
Worker almost nothing.

## Using your own domain

Put the two hostnames in `.env` and deploy. The script attaches both.

```
API_ORIGIN=https://api.example.com
WEB_ORIGIN=https://app.example.com
```

```bash
./scripts/deploy.sh
```

The Worker is bound with `wrangler deploy --domain`, and the Pages project
through the Cloudflare API. Both create the DNS record and the certificate for
you, as long as the zone is on the same account.

**No zone id is needed.** Custom domains exist precisely so you do not have to
touch DNS, which is why nothing in `.env.example` asks for one. If you have seen
`CLOUDFLARE_ZONE_ID` in other projects, that is for ordinary Worker routes
(`example.com/api/*`), which this does not use.

A certificate takes a few minutes the first time. A connection failure straight
after a first deploy is usually that, not a mistake.

If the zone lives on a different Cloudflare account from the Worker, neither
call can write the DNS record. The script says so and keeps going, and you add a
CNAME on the account that holds the zone.

Both origins must be HTTPS. The session cookie is set with `Secure` and
`SameSite=None` because the two halves are on different origins, and a browser
refuses to store that over plain HTTP.

## Adding a workspace for someone else

There is no self-serve sign-up form for other people by design. Create a
workspace for them and send the link:

```bash
ADMIN_TOKEN='...' node apps/api/scripts/provision-tenant.ts \
  them@example.com "Their organisation" https://api.example.com
```

It prints a one-time link. Sending it to them is the whole handover: the link
opens a page on your own deployment where they choose a password, and it is
never transmitted to you or known by you. The link works once.

## Optional providers

Each of these is optional. Adding one makes it available as a choice; it never
replaces what is already working.

**OpenAI.** Better answers and an alternative embedding model, billed by OpenAI.
Add `OPENAI_API_KEY` to `.env` and deploy again.

**DeepSeek.** Add `DEEPSEEK_API_KEY`. Note that DeepSeek models are also on
Workers AI without a DeepSeek account, though Cloudflare requires a billing
method for those.

**LlamaParse.** Reads scanned documents that have no extractable text. Add
`LLAMA_CLOUD_API_KEY`. The free plan gives 10,000 credits a month, about 3,300
pages at the cost effective tier. Only reachable on the paid tier, since it runs
in the Worker.

After adding any key, deploy again and pick it on the settings screen.

## Deploying from GitHub Actions

The repository carries a `Deploy demo` workflow. It deploys to **your** Cloudflare
account using **your** credentials, and there are none in the repository. Nothing
is shared, and a fresh clone cannot deploy anything until you supply your own.

Set them on your own copy, under Settings, then Secrets and variables, then
Actions. Secrets there are encrypted, are never shown again after you save them,
and are not given to workflows started by a pull request from a fork.

Secrets, the values that must not be printed:

```
CLOUDFLARE_API_TOKEN  CLOUDFLARE_ACCOUNT_ID  BETTER_AUTH_SECRET
ADMIN_TOKEN           DEMO_COOKIE_SECRET     OPENAI_API_KEY
DEEPSEEK_API_KEY      LLAMA_CLOUD_API_KEY
```

Variables, the values that are safe to read in a log, are the rest of your
`.env`: the origins, the resource names, the tier and the limits. The workflow
lists every one it reads, and the first step fails with the name of anything
missing rather than deploying half a configuration.

The three provider keys are only needed if you use those providers. See
[Optional providers](#optional-providers) above.

The workflow runs by hand only. There is no trigger on push, so merging
something never spends your Cloudflare allowance or changes a running site on
its own. Open the Actions tab, choose `Deploy demo`, and type `deploy` to
confirm.

You do not have to use it. `./scripts/deploy.sh` does the same work from your
own machine, reading the same names from `.env`, and never sends a credential
anywhere except Cloudflare.

## Keeping it up to date

```bash
git pull
npm install
./scripts/deploy.sh
```

Migrations are applied by the script. They only ever add.

## Costs

Nothing, until you cross an allowance. See [free-tier.md](free-tier.md) for
where those sit and what happens when you reach one. The free plan stops rather
than charging you.

If you want more headroom, the Workers Paid plan is five dollars a month. Turn
it on in the Cloudflare dashboard, then switch your workspace to the paid tier
on the settings screen.

## When something goes wrong

**"Cloudflare rejected those credentials."** The token is missing a permission
from the table above, or the account id is wrong.

**Sign-in does nothing and the browser console mentions cookies.** `API_ORIGIN`
and `WEB_ORIGIN` in `.env` do not match where the app is actually served from.
Fix them and deploy again.

**"Worker exceeded CPU time limit" on sign-in.** `PASSWORD_KDF_ITERATIONS` is
set too high for the free plan. The default of 100000 fits; 600000 needs the
paid plan.

**Uploads fail on a scanned PDF.** There is no text in it to extract. That needs
the paid tier and a LlamaParse key.

**Answers are poor after changing the embedding model.** The settings screen
will be showing a re-index prompt. Old passages are in a different vector space
until you take it.

If none of that helps, open an issue with what you ran and what it printed.
