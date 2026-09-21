use super::Storage;
use crate::error::AppError;

#[test]
fn repository_transactions_commit_or_roll_back_as_one_unit_and_release_lock() {
    let storage = Storage::open_in_memory().unwrap();
    storage
        .with_transaction(|tx| {
            tx.execute_batch("CREATE TEMP TABLE f0_probe (value INTEGER NOT NULL)")?;
            tx.execute("INSERT INTO f0_probe VALUES (1)", [])?;
            Ok(())
        })
        .unwrap();
    let failed: Result<(), AppError> = storage.with_transaction(|tx| {
        tx.execute("INSERT INTO f0_probe VALUES (2)", [])?;
        tx.execute("INSERT INTO f0_probe VALUES (3)", [])?;
        Err(AppError::InvalidInput("abort entire operation".into()))
    });
    assert!(failed.is_err());
    let values: Vec<i64> = storage
        .with_read(|connection| {
            let mut query = connection.prepare("SELECT value FROM f0_probe ORDER BY value")?;
            let rows = query.query_map([], |row| row.get(0))?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        })
        .unwrap();
    assert_eq!(values, vec![1]);
    // A callback's error must neither poison nor retain the connection lock.
    assert_eq!(storage.schema_version().unwrap(), 18);
}

#[test]
fn sql_failure_rolls_back_prior_writes() {
    let storage = Storage::open_in_memory().unwrap();
    storage
        .with_transaction(|tx| {
            tx.execute_batch("CREATE TEMP TABLE f0_unique (value INTEGER UNIQUE)")?;
            Ok(())
        })
        .unwrap();
    assert!(storage
        .with_transaction(|tx| {
            tx.execute("INSERT INTO f0_unique VALUES (1)", [])?;
            tx.execute("INSERT INTO f0_unique VALUES (1)", [])?;
            Ok(())
        })
        .is_err());
    let count: i64 = storage
        .with_read(|connection| {
            Ok(connection.query_row("SELECT COUNT(*) FROM f0_unique", [], |row| row.get(0))?)
        })
        .unwrap();
    assert_eq!(count, 0);
}
