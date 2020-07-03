
const
    sqlite3 = require('sqlite3'),
    { open } = require('sqlite');

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
        // this.connection.on('trace', (data) => {
        //     console.log(data);
        // });

        await this.connection.migrate();
    }

    getCurrentDateStr() {
        const d = new Date();
        return d.getFullYear() + ("0"+(d.getMonth()+1)).slice(-2) + ("0" + d.getDate()).slice(-2) +
            ("0" + d.getHours()).slice(-2) + ("0" + d.getMinutes()).slice(-2) + ("0" + d.getSeconds()).slice(-2);
    }

    async setBuildFixed(library, library_version, compiler, compiler_version, arch, libcxx, compiler_flags) {
        const stmt = await this.connection.prepare(
            `delete from latest
                where library=@library
                  and library_version=@library_version
                  and compiler=@compiler
                  and compiler_version=@compiler_version
                  and arch=@arch
                  and libcxx=@libcxx
                  and compiler_flags=@compiler_flags`);
    
        await stmt.bind({
            '@library': library,
            '@library_version': library_version,
            '@compiler': compiler,
            '@compiler_version': compiler_version,
            '@arch': arch,
            '@libcxx': libcxx,
            '@compiler_flags': compiler_flags
        });

        await stmt.run();
    }

    async setBuildFailed(library, library_version, compiler, compiler_version, arch, libcxx, compiler_flags, logging) {
        const now = this.getCurrentDateStr();

        const stmt = await this.connection.prepare(
            `replace into latest
            ( library, library_version, compiler, compiler_version, arch, libcxx, compiler_flags, success, build_dt, logging)
            values
            ( @library, @library_version, @compiler, @compiler_version, @arch, @libcxx, @compiler_flags, 0, @now, @logging);`);

        await stmt.bind({
            '@library': library,
            '@library_version': library_version,
            '@compiler': compiler,
            '@compiler_version': compiler_version,
            '@arch': arch,
            '@libcxx': libcxx,
            '@compiler_flags': compiler_flags,
            '@now': now,
            '@logging': logging
        });

        await stmt.run();
    }

    async listBuilds() {
        const results = await this.connection.all(
            SQL`select library, library_version, compiler, compiler_version, arch, libcxx, compiler_flags, success, build_dt
                 from latest
                order by library asc, library_version asc, compiler asc, compiler_version asc`);

        return results;
    }

    async getLogging(library, library_version, compiler, compiler_version, libcxx, compiler_flags) {
        const stmt = await this.connection.prepare(
            `select logging
                 from latest
                where library=@library
                  and library_version=@library_version
                  and compiler=@compiler
                  and compiler_version=@compiler_version
                  and compiler_libcxx=@compiler_libcxx
                  and compiler_flags=@compiler_flags`
        );

        await stmt.bind({
            '@library': library,
            '@library_version': library_version,
            '@compiler': compiler,
            '@compiler_version': compiler_version,
            '@arch': arch,
            '@libcxx': libcxx,
            '@compiler_flags': compiler_flags
        });

        const results = await stmt.all();

        return results;
    }
};


module.exports = {
    BuildLogging
};
