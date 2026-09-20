import { Octokit } from "https://esm.sh/octokit";

async function list_last_10(morediv, owner, repo, lib_name, lib_version) {
    const octokit = new Octokit({
        // auth: 'YOUR-TOKEN'
    });
  
    const list = await octokit.request('GET /repos/{owner}/{repo}/commits', {
        owner: owner,
        repo: repo,
        headers: {
            'X-GitHub-Api-Version': '2022-11-28'
        }
    });

    for (const item of list.data) {
        const shorthash = item.sha.substring(0, 8);

        const elem = $(`<a>${shorthash}</a>`);
        elem.attr("href", `/cpp_library_build_results/${lib_name}/${lib_version}/${shorthash}`);

        const li = $("<li />");
        li.append(elem);

        const desc = $("<span />");
        desc.html(" " + item.commit.author.date);
        li.append(desc);

        morediv.append(li);
    }
}

const morediv = $(".more-commits");
const config = morediv.length ? morediv[0].dataset : null;
if (config && config.repoOwner && config.repoName) {
    list_last_10(morediv, config.repoOwner, config.repoName, config.libName, config.libVersion);
}
