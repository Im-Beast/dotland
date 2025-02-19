// Copyright 2022 the Deno authors. All rights reserved. MIT license.

/** @jsx h */
/** @jsxFrag Fragment */
import { Fragment, h } from "preact";
import { Handlers, PageProps, RouteConfig } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import { tw } from "@twind";
import twas from "$twas";
import { emojify } from "$emoji";
import { accepts } from "$oak_commons";
import {
  type DocPage,
  type DocPageIndex,
  type DocPageModule,
  type DocPageSymbol,
  extractAltLineNumberReference,
  fetchSource,
  getBasePath,
  getModulePath,
  getRawFile,
  getReadme,
  getRepositoryURL,
  getSourceURL,
  getVersionList,
  type InfoPage,
  type ModInfoPage,
  type SourcePage,
} from "@/util/registry_utils.ts";
import { Header } from "@/components/Header.tsx";
import { Footer } from "@/components/Footer.tsx";
import { ErrorMessage } from "@/components/ErrorMessage.tsx";
import { DocView } from "@/components/DocView.tsx";
import * as Icons from "@/components/Icons.tsx";
import VersionSelect from "@/islands/VersionSelect.tsx";
import { SourceView } from "@/components/SourceView.tsx";
import { PopularityTag } from "@/components/PopularityTag.tsx";
import { SidePanelPage } from "@/components/SidePanelPage.tsx";
import { Markdown } from "@/components/Markdown.tsx";

type Views = "doc" | "source" | "info";
type Params = {
  name: string;
  version: string;
  path: string;
};

type Data =
  | { data: DocPage; view: "doc" }
  | { data: SourcePage; view: "source" }
  | { data: InfoPage; view: "info" };
type MaybeData =
  | Data
  | null;

export const handler: Handlers<MaybeData> = {
  async GET(req, { params, render }) {
    const { name, version, path } = params as Params;
    const url = new URL(req.url);

    if (name === "std" && url.pathname.startsWith("/x")) {
      url.pathname = url.pathname.slice(2);
      return Response.redirect(url, 301);
    }

    const isHTML = accepts(req, "application/*", "text/html") === "text/html";
    if (!isHTML) return handlerRaw(req, params as Params);

    let view: Views;
    if (url.searchParams.has("source")) {
      view = "source";
    } else if (url.searchParams.has("doc")) {
      view = "doc";
    } else if (!path) {
      view = "info";
    } else {
      view = "doc";
    }

    const resURL = new URL(
      `https://apiland.deno.dev/v2/pages/mod/${view}/${name}/${
        version || "__latest__"
      }/${path}`,
    );

    const symbol = url.searchParams.get("s");
    if (symbol && view === "doc") {
      resURL.searchParams.set("symbol", symbol);
    }

    let data: Data;

    const res = await fetch(resURL, {
      redirect: "manual",
    });
    if (res.status === 404) { // module doesnt exist
      return render(null);
    } else if (res.status === 302) { // implicit latest
      const latestVersion = res.headers.get("X-Deno-Latest-Version")!;
      console.log(getModulePath(
        name,
        latestVersion,
        path ? ("/" + path) : undefined,
      ));
      return Response.redirect(
        new URL(
          getModulePath(
            name,
            latestVersion,
            path ? ("/" + path) : undefined,
          ),
          url,
        ),
      );
    } else if (res.status === 301) { // path is directory and there is an index module and its doc
      const newPath = res.headers.get("X-Deno-Module-Path")!;
      return new Response(undefined, {
        headers: {
          Location: getModulePath(
            name,
            version,
            newPath,
          ),
        },
        status: 301,
      });
    } else {
      data = { data: await res.json(), view };
    }

    if (data.data.kind === "no-versions") {
      return render!(data);
    }

    if (data.view === "doc" && data.data.kind === "file") {
      url.searchParams.set("source", "");
      return Response.redirect(url, 301);
    }

    const ln = extractAltLineNumberReference(url.pathname);
    if (ln) {
      url.pathname = ln.rest;
      url.searchParams.set("source", "");
      url.hash = "L" + ln.line;
      return Response.redirect(url, 302);
    }

    if (data.data.kind === "modinfo" && data.data.readme) {
      data.data.readmeFile = await getReadme(name, version, data.data.readme);
    } else if (data.view === "source" && data.data.kind === "file") {
      data.data.file = await getRawFile(name, version, path ? `/${path}` : "");
    }

    return render!(data);
  },
};

const RAW_HEADERS = { "Access-Control-Allow-Origin": "*" };

// Note: this function is _very_ hot. It is called for every download of a /x/
// module. We need to be careful about what we do here. This code must not rely
// on any services other than S3.
async function handlerRaw(
  req: Request,
  { name, version, path }: Params,
): Promise<Response> {
  if (version === "") {
    const versions = await getVersionList(name);
    if (versions === null) {
      return new Response(`The module '${name}' does not exist`, {
        status: 404,
        headers: RAW_HEADERS,
      });
    }
    if (versions.latest === null) {
      return new Response(`The module '${name}' has no latest version.`, {
        status: 404,
        headers: RAW_HEADERS,
      });
    }
    if (path) path = `/${path}`;
    return new Response(undefined, {
      status: 302,
      headers: {
        ...RAW_HEADERS,
        Location: getModulePath(name, versions.latest, path),
        "x-deno-warning":
          `Implicitly using latest version (${versions.latest}) for ${req.url}`,
      },
    });
  }

  return fetchSource(name, version, path);
}

export default function Registry({ params, url, data }: PageProps<MaybeData>) {
  let {
    name,
    version,
    path: maybePath,
  } = params as Params;
  version &&= decodeURIComponent(version);

  const path = maybePath ? "/" + maybePath : "";
  const isStd = name === "std";

  return (
    <>
      <Head>
        <title>{name + (version ? `@${version}` : "") + " | Deno"}</title>
      </Head>
      <div class={tw`bg-primary min-h-full`}>
        <Header
          selected={name === "std" ? "Standard Library" : "Third Party Modules"}
        />
        {data === null
          ? (
            <div class={tw`section-x-inset-xl pb-20 pt-10`}>
              <ErrorMessage title="404 - Not Found">
                This module does not exist.
              </ErrorMessage>
            </div>
          )
          : (
            <>
              {data.data.kind !== "modinfo" && (
                <TopPanel
                  version={version!}
                  {...{
                    name,
                    path,
                    ...data,
                  }}
                />
              )}
              <ModuleView
                version={version!}
                {...{ name, path, isStd, url, data }}
              />
            </>
          )}
        <Footer />
      </div>
    </>
  );
}

function TopPanel({
  name,
  version,
  path,
  data,
  view,
}: {
  name: string;
  version: string;
  path: string;
} & Data) {
  const hasPageBase = data.kind !== "invalid-version" &&
    data.kind !== "no-versions";

  const popularityTag = hasPageBase
    ? data.tags?.find((tag) => tag.kind === "popularity")
    : undefined;
  return (
    <div class={tw`bg-ultralight border-b border-light-border`}>
      <div class={tw`section-x-inset-xl py-5 flex items-center`}>
        <div
          class={tw`flex flex-col md:(flex-row items-center) justify-between w-full gap-4`}
        >
          <div class={tw`overflow-hidden`}>
            <Breadcrumbs
              name={name}
              version={version}
              path={path}
              view={view}
            />

            {data.kind !== "no-versions" && data.description &&
              (
                <div
                  class={tw`text-sm lg:truncate`}
                  title={emojify(data.description)}
                >
                  {emojify(data.description)}
                </div>
              )}
          </div>
          <div
            class={tw`flex flex-col items-stretch gap-4 w-full md:w-auto lg:(flex-row justify-between) flex-shrink-0`}
          >
            {hasPageBase && (
              <div
                class={tw`flex flex-row justify-between md:justify-center items-center gap-4 border border-dark-border rounded-md bg-white py-2 px-5`}
              >
                <div class={tw`flex items-center whitespace-nowrap gap-2`}>
                  <Icons.GitHub class="w-5 h-5 inline text-gray-700" />
                  <a
                    class={tw`link`}
                    href={`https://github.com/${data.upload_options.repository}`}
                  >
                    {data.upload_options.repository}
                  </a>
                </div>
                {popularityTag && name !== "std" && (
                  <PopularityTag>{popularityTag.value}</PopularityTag>
                )}
              </div>
            )}
            {data.kind !== "no-versions" && (
              <VersionSelector
                versions={data.versions}
                selectedVersion={version}
                name={name}
                path={path}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModuleView({
  name,
  version,
  path,
  isStd,
  url,
  data,
}: {
  name: string;
  version: string;
  path: string;
  isStd: boolean;
  url: URL;
  data: Data;
}) {
  if (data.data.kind === "no-versions") {
    return (
      <ErrorMessage title="No uploaded versions">
        This module name has been reserved for a repository, but no versions
        have been uploaded yet. Modules that do not upload a version within 30
        days of registration will be removed.
      </ErrorMessage>
    );
  } else if (data.data.kind === "invalid-version") {
    return (
      <ErrorMessage title="404 - Not Found">
        This version does not exist for this module.
      </ErrorMessage>
    );
  } else if (data.data.kind === "notfound") {
    return (
      <ErrorMessage title="404 - Not Found">
        This file or directory could not be found.
      </ErrorMessage>
    );
  }

  const repositoryURL = getRepositoryURL(
    data.data.upload_options,
    path,
    data.data.kind === "index" ? "tree" : undefined,
  );

  if (data.view === "info") {
    return <InfoView version={version!} data={data.data} name={name} />;
  } else if (data.view === "source") {
    return (
      <SourceView
        {...{
          isStd,
          name,
          version,
          path,
          url,
          data: data.data,
          repositoryURL,
        }}
      />
    );
  } else {
    return (
      <DocView
        {...{
          isStd,
          name,
          version,
          path,
          url,
          data: data.data as DocPageSymbol | DocPageModule | DocPageIndex,
          repositoryURL,
        }}
      />
    );
  }
}

function Breadcrumbs({
  name,
  path,
  version,
  view,
}: {
  name: string;
  version: string;
  path: string;
  view: Views;
}) {
  const segments = path.split("/").splice(1);
  segments.unshift(name);
  if (name !== "std") {
    segments.unshift("x");
  }

  let seg = "";
  const out: [segment: string, url: string][] = [];
  for (const segment of segments) {
    if (segment === "") {
      continue;
    } else if (segment === name) {
      seg += `/${segment}@${version}`;
    } else if (segment !== "") {
      seg += "/" + segment;
    }

    out.push([segment, seg]);
  }

  return (
    <p class={tw`text-xl leading-6 font-bold text-gray-400 truncate`}>
      {out.map(([seg, url], i) => {
        if (view === "source") {
          url += "?source";
        }
        return (
          <Fragment key={i}>
            {i !== 0 && "/"}
            <a href={url} class={tw`link`} title={seg}>
              {seg}
            </a>
          </Fragment>
        );
      })}
    </p>
  );
}

function VersionSelector({
  versions,
  selectedVersion,
  name,
  path,
}: {
  versions: string[];
  selectedVersion: string;
  name: string;
  path: string;
}) {
  return (
    <>
      <VersionSelect
        versions={Object.fromEntries(
          versions.map((ver) => [ver, getModulePath(name, ver, path)]),
        )}
        selectedVersion={selectedVersion}
      />
      {versions[0] !== selectedVersion && (
        <a
          class={tw`py-2.5 px-4.5 text-white bg-tag-blue hover:bg-blue-500 rounded-md leading-none`}
          aria-label="Go to latest version"
          href={getModulePath(name, versions[0], path)}
        >
          Go to Latest
        </a>
      )}
    </>
  );
}

function InfoView(
  { name, data, version }: {
    name: string;
    version: string;
    data: ModInfoPage;
  },
) {
  data.description &&= emojify(data.description);

  const attributes = [];

  const popularityTag = data.tags?.find((tag) => tag.kind === "popularity");
  if (popularityTag && name !== "std") {
    attributes.push(
      <PopularityTag>{popularityTag.value}</PopularityTag>,
    );
  }

  if (data.upload_options.repository.split("/")[0] == "denoland") {
    attributes.push(
      <div class={tw`flex items-center gap-1.5`}>
        <Icons.CheckmarkVerified />
        <span class={tw`text-tag-blue font-medium leading-none`}>
          By Deno Team
        </span>
      </div>,
    );
  }

  if (data.config) {
    attributes.push(
      <div class={tw`flex items-center gap-1.5`}>
        <Icons.Logo />
        <span class={tw`text-gray-600 font-medium leading-none`}>
          Includes Deno configuration
        </span>
      </div>,
    );
  }

  return (
    <SidePanelPage
      sidepanel={
        <div class={tw`space-y-6 children:space-y-2`}>
          <div class={tw`space-y-4!`}>
            <div class={tw`space-y-2`}>
              <div class={tw`flex items-center gap-2.5 w-full`}>
                <Breadcrumbs
                  name={name}
                  version={version}
                  path="/"
                  view="info"
                />
                <div class={tw`tag bg-default-15 text-gray-600 font-semibold!`}>
                  {version}
                </div>
              </div>

              {data.description &&
                (
                  <div class={tw`text-sm`} title={data.description}>
                    {data.description}
                  </div>
                )}
            </div>

            <div
              class={tw`space-y-3 children:(flex items-center gap-1.5 leading-none font-medium)`}
            >
              <span>
                <Icons.Manual />
                <a href={getBasePath(name, version) + "?doc"} class={tw`link`}>
                  View Documentation
                </a>
              </span>
              <span>
                <Icons.Source />
                <a
                  href={getBasePath(name, version) + "?source"}
                  class={tw`link`}
                >
                  View Source
                </a>
              </span>
            </div>
          </div>

          {attributes.length !== 0 && (
            <div class={tw`space-y-2.5!`}>
              <div class={tw`text-gray-400 font-medium text-sm leading-4`}>
                Attributes
              </div>
              {attributes}
            </div>
          )}

          <div>
            <div class={tw`text-gray-400 font-medium text-sm leading-4`}>
              Repository
            </div>
            <div class={tw`flex items-center gap-1.5 whitespace-nowrap`}>
              <Icons.GitHub class="w-5 h-5 text-gray-700 flex-none" />
              <a
                class={tw`link truncate`}
                href={`https://github.com/${data.upload_options.repository}`}
              >
                {data.upload_options.repository}
              </a>
            </div>
          </div>

          <div>
            <div class={tw`text-gray-400 font-medium text-sm leading-4`}>
              Current version released
            </div>
            <div title={data.uploaded_at}>
              {twas(new Date(data.uploaded_at))}
            </div>
          </div>

          <div>
            <div class={tw`text-gray-400 font-medium text-sm leading-4`}>
              Versions
            </div>
            <ol
              class={tw`border border-secondary rounded-lg list-none overflow-y-scroll max-h-80`}
            >
              {data.versions.map((listVersion) => (
                <li class={tw`odd:(bg-ultralight rounded-md)`}>
                  <a
                    class={tw`flex px-5 py-2 link ${
                      listVersion === version ? "font-bold" : "font-medium"
                    }`}
                    href={getBasePath(name, listVersion)}
                  >
                    <span class={tw`block w-full truncate`}>{listVersion}</span>
                    {listVersion === data.latest_version && (
                      <div class={tw`tag bg-tag-blue-bg text-tag-blue`}>
                        Latest
                      </div>
                    )}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </div>
      }
    >
      <div class={tw`p-6 rounded-xl border border-dark-border`}>
        {data.readmeFile
          ? (
            <Markdown
              source={name === "std"
                ? data.readmeFile.content!
                : data.readmeFile.content!.replace(/\$STD_VERSION/g, version)}
              baseURL={getSourceURL(name, version, "/")}
            />
          )
          : (
            <div
              class={tw`flex items-center justify-center italic text-gray-400 -m-2`}
            >
              No readme found.
            </div>
          )}
      </div>
    </SidePanelPage>
  );
}

export const config: RouteConfig = {
  routeOverride: "/x/:name{@:version}?/:path*",
};
