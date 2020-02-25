(ns metabase.driver.redshiftspectrum
  "Amazon Redshift (Spectrum enabled) Driver."
  (:require [clojure.java.jdbc :as jdbc]
            [clojure.string :as str]
            [honeysql.core :as hsql]
            [metabase.driver :as driver]
            [clojure.set :as set]
            [metabase.driver.common :as driver.common]
            [metabase.driver.sql-jdbc
             [sync :as sql-jdbc.sync]
             [connection :as sql-jdbc.conn]
             [execute :as sql-jdbc.execute]]
            ;[util :as u]
            [metabase
             [util :as u]]
            [metabase.driver.sql-jdbc.execute.legacy-impl :as legacy]
            [metabase.driver.sql.query-processor :as sql.qp]
            [metabase.util.honeysql-extensions :as hx])
  (:import java.sql.Types
           java.time.OffsetTime))

(driver/register! :redshiftspectrum, :parent #{:postgres ::legacy/use-legacy-classes-for-read-and-set})

;;; +----------------------------------------------------------------------------------------------------------------+
;;; |                                             metabase.driver impls                                              |
;;; +----------------------------------------------------------------------------------------------------------------+

;; don't use the Postgres implementation for `describe-table` since it tries to fetch enums which Redshift doesn't
;; support
(defmethod driver/describe-table :redshiftspectrum
  [& args]
  (apply (get-method driver/describe-table :sql-jdbc) args))

;; The Postgres JDBC .getImportedKeys method doesn't work for Redshift, and we're not allowed to access
;; information_schema.constraint_column_usage, so we'll have to use this custom query instead
;;
;; See also: [Related Postgres JDBC driver issue on GitHub](https://github.com/pgjdbc/pgjdbc/issues/79)
;;           [How to access the equivalent of information_schema.constraint_column_usage in Redshift](https://forums.aws.amazon.com/thread.jspa?threadID=133514)
(def ^:private fk-query
  "SELECT source_column.attname AS \"fk-column-name\",
          dest_table.relname    AS \"dest-table-name\",
          dest_table_ns.nspname AS \"dest-table-schema\",
          dest_column.attname   AS \"dest-column-name\"
   FROM pg_constraint c
          JOIN pg_namespace n             ON c.connamespace          = n.oid
          JOIN pg_class source_table      ON c.conrelid              = source_table.oid
          JOIN pg_attribute source_column ON c.conrelid              = source_column.attrelid
          JOIN pg_class dest_table        ON c.confrelid             = dest_table.oid
          JOIN pg_namespace dest_table_ns ON dest_table.relnamespace = dest_table_ns.oid
          JOIN pg_attribute dest_column   ON c.confrelid             = dest_column.attrelid
   WHERE c.contype                 = 'f'::char
          AND source_table.relname = ?
          AND n.nspname            = ?
          AND source_column.attnum = ANY(c.conkey)
          AND dest_column.attnum   = ANY(c.confkey)")

(defmethod driver/describe-table-fks :redshiftspectrum
  [_ database table]
  (set (for [fk (jdbc/query (sql-jdbc.conn/db->pooled-connection-spec database)
                            [fk-query (:name table) (:schema table)])]
         {:fk-column-name   (:fk-column-name fk)
          :dest-table       {:name   (:dest-table-name fk)
                             :schema (:dest-table-schema fk)}
          :dest-column-name (:dest-column-name fk)})))

(defmethod driver/format-custom-field-name :redshiftspectrum
  [_ custom-field-name]
  (str/lower-case custom-field-name))

;; The docs say TZ should be allowed at the end of the format string, but it doesn't appear to work
;; Redshift is always in UTC and doesn't return it's timezone
(defmethod driver.common/current-db-time-date-formatters :redshiftspectrum
  [_]
  (driver.common/create-db-time-formatters "yyyy-MM-dd HH:mm:ss.SSS zzz"))

(defmethod driver.common/current-db-time-native-query :redshiftspectrum
  [_]
  "select to_char(current_timestamp, 'YYYY-MM-DD HH24:MI:SS.MS TZ')")

(defmethod driver/current-db-time :redshiftspectrum
  [& args]
  (apply driver.common/current-db-time args))

(defn- describe-external-databases [database]
  "Fetch the external tables used by Redshift Spectrum"
  (set (jdbc/query (sql-jdbc.conn/db->pooled-connection-spec database)
                   ["SELECT schemaname as \"schema\",
                                     tablename as \"name\"
                             FROM svv_external_tables"
                    ])))

(defmethod driver/describe-database :redshiftspectrum
  [driver database]
  (update (sql-jdbc.sync/describe-database driver database) :tables (u/rpartial set/union (describe-external-databases database))))

;;; +----------------------------------------------------------------------------------------------------------------+
;;; |                                           metabase.driver.sql impls                                            |
;;; +----------------------------------------------------------------------------------------------------------------+

(defmethod driver/date-add :redshiftspectrum
  [_ hsql-form amount unit]
  (hsql/call :dateadd (hx/literal unit) amount (hx/->timestamp hsql-form)))

(defmethod sql.qp/unix-timestamp->timestamp [:redshiftspectrum :seconds]
  [_ _ expr]
  (hx/+ (hsql/raw "TIMESTAMP '1970-01-01T00:00:00Z'")
        (hx/* expr
              (hsql/raw "INTERVAL '1 second'"))))

(defmethod sql.qp/current-datetime-fn :redshiftspectrum
  [_]
  :%getdate)

(defmethod sql-jdbc.execute/set-timezone-sql :redshiftspectrum
  [_]
  "SET TIMEZONE TO %s;")

;;; +----------------------------------------------------------------------------------------------------------------+
;;; |                                         metabase.driver.sql-jdbc impls                                         |
;;; +----------------------------------------------------------------------------------------------------------------+

(defmethod sql-jdbc.conn/connection-details->spec :redshiftspectrum
  [_ {:keys [host port db], :as opts}]
  (merge
   {:classname                     "com.amazon.redshift.jdbc.Driver"
    :subprotocol                   "redshift"
    :subname                       (str "//" host ":" port "/" db)
    :ssl                           true
    :OpenSourceSubProtocolOverride false}
   (dissoc opts :host :port :db)))

(prefer-method
 sql-jdbc.execute/read-column-thunk
 [::legacy/use-legacy-classes-for-read-and-set Types/TIMESTAMP]
 [:postgres Types/TIMESTAMP])

(prefer-method
 sql-jdbc.execute/set-parameter
 [::legacy/use-legacy-classes-for-read-and-set OffsetTime]
 [:postgres OffsetTime])
