
const
    sqlite3 = require('sqlite3'),
    { open } = require('sqlite'),
    { SQL } = require('sql-template-strings');

class BuildLogging {
    constructor(databasepath) {
        this.databasepath = databasepath;
        this.connection = null;
    }

    async connect() {
        this.connection = await open({
            filename: this.databasepath,
            driver: sqlite3.Database
          });
          await this.connection.migrate();
    }

    getCurrentDateStr() {
        const d = new Date();
        return d.getFullYear() + ("0"+(d.getMonth()+1)).slice(-2) + ("0" + d.getDate()).slice(-2) +
            ("0" + d.getHours()).slice(-2) + ("0" + d.getMinutes()).slice(-2) + ("0" + d.getSeconds()).slice(-2);
    }

    async setBuildFixed(library, library_version, compiler, compiler_version, arch, libcxx, compiler_flags) {
        await this.connection.exec(
            SQL`delete from latest
                where library=${library}
                  and library_version=${library_version}
                  and compiler=${compiler}
                  and compiler_version=${compiler_version}
                  and arch=${arch}
                  and libcxx=${libcxx}
                  and compiler_flags=${compiler_flags}`);
    }

    async setBuildFailed(library, library_version, compiler, compiler_version, arch, libcxx, compiler_flags, logging) {
        const now = this.getCurrentDateStr();
        await this.connection.exec(
            SQL`replace into latest
                ( library, library_version, compiler, compiler_version, arch, libcxx, compiler_flags, success, build_dt, logging)
                values
                ( ${library}, ${library_version}, ${compiler}, ${compiler_version}, ${arch}, ${libcxx}, ${compiler_flags}, 0, ${now}, ${logging});`);
    }

    async listBuilds() {
        const results = await this.connection.all(
            SQL`select library, library_version, compiler, compiler_version, arch, libcxx, compiler_flags, success, build_dt
                 from latest
                order by library asc, library_version asc, compiler asc, compiler_version asc`);

        return results;
    }

    async getLogging(library, library_version, compiler, compiler_version, compiler_libcxx, compiler_flags) {
        const results = await this.connection.all(
            SQL`select logging
                 from latest
                where library=${library}
                  and library_version=${library_version}
                  and compiler=${compiler}
                  and compiler_version=${compiler_version}
                  and compiler_libcxx=${compiler_libcxx}
                  and compiler_flags=${compiler_flags}`);

        return results;
    }
};


module.exports = {
    BuildLogging
};
