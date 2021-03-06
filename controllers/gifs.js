/* eslint-disable camelcase */
const fs = require('fs');
const db = require('../dbconn');
const cloud = require('../middleware/cloudinary');
const lib = require('../middleware/lib');

exports.create = (req, res) => {
  const validate = () => {
    let isValid = true;
    const test = {};

    // Test to validate title
    if (req.body.title) {
      req.body.title = req.body.title.toLowerCase();
      test.title = lib.isEmpty(req.body.title) ? 'Invalid: can\'t be empty' : 'Valid';
    } else test.title = 'Undefined';

    // Test to validate passport
    if (req.file) {
      test.image = req.file.mimetype !== 'image/gif' ? 'Invalid: file type must be GIF' : 'Valid';
    } else test.image = 'Undefined';

    const error = {};
    Object.keys(test).forEach((key) => {
      if (test[key] !== 'Valid') {
        error[key] = test[key];
        if (isValid) isValid = false;
      }
    });

    return isValid ? { status: true } : { status: false, error };
  };
  const report = validate();

  // Validate request before submitting
  if (report.status) {
    // Upload the gif image cloudinary
    cloud.uploads(req.file.path).then(({ secure_url }) => {
      fs.unlink(req.file.path, (error) => (error ? console.log('Unable to delete file after upload :', error) : ''));

      // Register in posts table
      db.query('INSERT INTO posts ("post_type", "post_author") VALUES ($1, $2) RETURNING "post_id", "created_on"',
        ['gif', req.loggedInUser.user_id]).then(({ rows: [{ post_id: postId, created_on: createdOn }] }) => {
        // Register in gifs table
        db.query('INSERT INTO gifs ("post_id", "image_url", "title") VALUES ($1, $2, $3)',
          [postId, secure_url, req.body.title]).then(() => {
          // console.log('GIF image successfully posted');
          res.status(201).json({
            status: 'success',
            data: {
              gifId: parseInt(postId, 10),
              message: 'GIF image successfully posted',
              createdOn,
              title: req.body.title,
              imageUrl: secure_url,
            },
          });
        }).catch((error) => {
          console.log(error);
          res.status(500).json({
            status: 'error',
            error: 'Sorry, we couldn\'t complete your request please try again',
          });
        });
      }).catch((error) => {
        console.log(error);
        res.status(500).json({
          status: 'error',
          error: 'Sorry, we couldn\'t complete your request please try again',
        });
      });
    }).catch((error) => {
      console.log('Cloudinary error ', error);
      fs.unlink(req.file.path, (err) => { console.log('Error at deleting failed upload passport', err); });
      res.status(500).json({
        status: 'error',
        error: 'Sorry, we couldn\'t complete your request please try again',
      });
    });
  } else {
    if (req.file) {
      fs.unlink(req.file.path, (error) => (error ? console.log('Unable to delete file after upload :', error) : ''));
    }
    res.status(400).json({
      status: 'error',
      error: report.error,
    });
  }
};

exports.modify = (req, res) => {
  const validate = () => {
    let test = 'Undefined';

    // Test to validate title
    if (req.body.title) {
      req.body.title = req.body.title.toLowerCase();
      test = lib.isEmpty(req.body.title) ? 'Invalid: can\'t be empty' : 'Valid';
    }
    return test === 'Valid' ? { status: true } : { status: false, error: { title: test } };
  };
  const report = validate();

  // Validate request before processing
  if (report.status) {
    // Verify that Gif exists
    db.query(`
      SELECT post_author
      FROM posts 
      WHERE post_id = $1
      AND post_type = 'gif'
    `, [req.params.id]).then(({ rows, rowCount }) => {
      if (rowCount === 0) {
        // Gif does not exist
        res.status(404).json({
          status: 'error',
          error: 'Gif not found',
        });
      } else if (rows[0].post_author !== parseInt(req.loggedInUser.user_id, 10)) {
        // Gif is valid but does not belong to Current user
        res.status(401).json({
          status: 'error',
          error: 'Unauthorized to modify this gif',
        });
      } else {
        // Gif is valid and belongs to current user
        // Update gif
        db.query(`UPDATE gifs
          SET "title" = $1 
          FROM posts 
          WHERE posts.post_id = gifs.post_id 
          AND posts.post_id = $2 
          AND posts.post_author = $3 RETURNING gifs.image_url, gifs.title`, [
          req.body.title,
          req.params.id,
          req.loggedInUser.user_id,
        ]).then(({ rows: [gif] }) => {
          res.status(200).json({
            status: 'success',
            data: {
              message: 'Gif successfully updated',
              title: gif.title,
              imageUrl: gif.image_url,
            },
          });
        }).catch((error) => {
          console.log(error);
          res.status(500).json({
            status: 'error',
            error: 'Sorry, we couldn\'t complete your request please try again',
          });
        });
      }
    }).catch((error) => {
      console.log(error);
      res.status(500).json({
        status: 'error',
        error: 'Sorry, we couldn\'t complete your request please try again',
      });
    });
  } else {
    res.status(400).json({
      status: 'error',
      error: report.error,
    });
  }
};

exports.getOne = (req, res) => {
  // Validate that post exist
  db.query(`
      SELECT *
      FROM posts 
      INNER JOIN gifs 
      ON posts.post_id = gifs.post_id
      WHERE posts.post_id = $1
      `, [req.params.id])
    .then(({ rowCount, rows }) => {
      if (rowCount === 0) {
        res.status(404).json({
          status: 'error',
          error: 'Gif not found',
        });
      } else {
        // Get comments
        const gif = rows[0];
        db.query(`
          SELECT comm.comment_id, comm.author_id, comm.comment, comm.created_on
          FROM posts 
          INNER JOIN post_comments comm
          ON posts.post_id = comm.post_id
          WHERE posts.post_id = $1
          `, [req.params.id]).then(({ rows: comm }) => {
          const comments = [];
          for (let i = 0; i < comm.length; i++) {
            comments.push({
              commentId: comm[i].comment_id,
              comment: comm[i].comment,
              authorId: comm[i].author_id,
              createdOn: comm[i].created_on,
            });
          }
          res.status(200).json({
            status: 'success',
            data: {
              id: gif.post_id,
              createdOn: gif.created_on,
              title: gif.title,
              url: gif.image_url,
              comments,
              authorId: gif.post_author,
            },
          });
        }).catch((error) => {
          console.log(error);
          res.status(500).json({
            status: 'error',
            error: 'Sorry, we couldn\'t complete your request please try again',
          });
        });
      }
    }).catch((error) => {
      console.log(error);
      res.status(500).json({
        status: 'error',
        error: 'Sorry, we couldn\'t complete your request please try again',
      });
    });
};

exports.flag = (req, res) => {
  const validate = () => {
    let isValid = true;
    const test = {};

    // Test to validate flag
    if (req.body.flag) {
      req.body.flag = req.body.flag.toLowerCase();
      test.flag = ['inappropriate', 'abusive', 'bullying', 'scam', 'misleading'].indexOf(req.body.flag) === -1 ? 'Invalid: Unacceptable' : 'Valid';
    } else test.flag = 'Undefined';

    // Test to validate reason
    if (req.body.reason) {
      req.body.reason = req.body.reason.toLowerCase();
      test.reason = lib.isEmpty(req.body.reason) ? 'Invalid: can\'t be empty' : 'Valid';
    } else test.reason = 'Undefined';

    const error = {};
    Object.keys(test).forEach((key) => {
      if (test[key] !== 'Valid') {
        error[key] = test[key];
        if (isValid) isValid = false;
      }
    });

    return isValid ? { status: true } : { status: false, error };
  };
  const report = validate();

  // Validate request before submitting
  if (report.status) {
    // Validate that gif post exist
    db.query(`
      SELECT gifs.post_id
      FROM posts 
      INNER JOIN gifs 
      ON posts.post_id = gifs.post_id
      WHERE posts.post_id = $1
    `, [req.params.id])
      .then(({ rowCount }) => {
        if (rowCount === 0) {
          res.status(404).json({
            status: 'error',
            error: 'Gif not found',
          });
        } else {
          db.query(`INSERT INTO 
            posts_and_comments_flags ("content_type", "content_id", "flag", "reason", "reporter") 
            VALUES ($1, $2, $3, $4, $5) RETURNING "reported_on", "report_id"`, [
            'gif',
            req.params.id,
            req.body.flag,
            req.body.reason,
            req.loggedInUser.user_id,
          ]).then(({ rows: [{ reported_on: reportedOn, report_id: reportId }] }) => {
            res.status(201).json({
              status: 'success',
              data: {
                message: 'Report successfully created',
                reportId,
                contentType: 'gif',
                contentId: parseInt(req.params.id, 10),
                flag: req.body.flag,
                reason: req.body.reason,
                reportedOn,
              },
            });
          }).catch((error) => {
            console.log(error);
            res.status(500).json({
              status: 'error',
              error: 'Sorry, we couldn\'t complete your request please try again',
            });
          });
        }
      }).catch((error) => {
        console.log(error);
        res.status(500).json({
          status: 'error',
          error: 'Sorry, we couldn\'t complete your request please try again',
        });
      });
  } else {
    res.status(400).json({
      status: 'error',
      error: report.error,
    });
  }
};

exports.comment = (req, res) => {
  const validate = () => {
    let test = 'Undefined';

    // Test to validate comment
    if (req.body.comment) {
      req.body.comment = req.body.comment.toLowerCase();
      test = lib.isEmpty(req.body.comment) ? 'Invalid: can\'t be empty' : 'Valid';
    }
    return test === 'Valid' ? { status: true } : { status: false, error: { comment: test } };
  };
  const report = validate();

  // Validate request before processing
  if (report.status) {
    // Validate that post exist
    db.query(`
      SELECT gifs.title
      FROM posts 
      INNER JOIN gifs 
      ON posts.post_id = gifs.post_id
      WHERE posts.post_id = $1
      `, [req.params.id])
      .then(({ rowCount, rows }) => {
        if (rowCount === 0) {
          res.status(404).json({
            status: 'error',
            error: 'Gif not found',
          });
        } else {
          // Insert comment
          const gifTitle = rows[0].title;
          db.query(`INSERT INTO post_comments (post_id, author_id, comment)
            VALUES ($1, $2, $3) RETURNING created_on, comment_id`, [
            req.params.id,
            req.loggedInUser.user_id,
            req.body.comment,
          ]).then(({ rows: [comm] }) => {
            res.status(201).json({
              status: 'success',
              data: {
                message: 'Comment successfully created',
                createdOn: comm.created_on,
                gifTitle,
                comment: req.body.comment,
                commentId: comm.comment_id,

              },
            });
          }).catch((error) => {
            console.log(error);
            res.status(500).json({
              status: 'error',
              error: 'Sorry, we couldn\'t complete your request please try again',
            });
          });
        }
      }).catch((error) => {
        console.log(error);
        res.status(500).json({
          status: 'error',
          error: 'Sorry, we couldn\'t complete your request please try again',
        });
      });
  } else {
    res.status(400).json({
      status: 'error',
      error: report.error,
    });
  }
};

exports.flagComment = (req, res) => {
  const validate = () => {
    let isValid = true;
    const test = {};

    // Test to validate flag
    if (req.body.flag) {
      req.body.flag = req.body.flag.toLowerCase();
      test.flag = ['inappropriate', 'abusive', 'bullying', 'scam', 'misleading'].indexOf(req.body.flag) === -1 ? 'Invalid: Unacceptable' : 'Valid';
    } else test.flag = 'Undefined';

    // Test to validate reason
    if (req.body.reason) {
      req.body.reason = req.body.reason.toLowerCase();
      test.reason = lib.isEmpty(req.body.reason) ? 'Invalid: can\'t be empty' : 'Valid';
    } else test.reason = 'Undefined';

    const error = {};
    Object.keys(test).forEach((key) => {
      if (test[key] !== 'Valid') {
        error[key] = test[key];
        if (isValid) isValid = false;
      }
    });

    return isValid ? { status: true } : { status: false, error };
  };
  const report = validate();

  // Validate request before submitting
  if (report.status) {
    // Validate that gif post exist
    db.query(`
      SELECT gifs.post_id
      FROM posts 
      INNER JOIN gifs 
      ON posts.post_id = gifs.post_id
      WHERE posts.post_id = $1
    `, [req.params.id])
      .then(({ rowCount }) => {
        if (rowCount === 0) {
          res.status(404).json({
            status: 'error',
            error: 'Gif not found',
          });
        } else {
          // Validate that comment exist
          db.query(`
            SELECT comment_id
            FROM post_comments 
            WHERE post_id = $1
            AND comment_id = $2
          `, [
            req.params.id,
            req.params.commentId,
          ])
            .then(({ rowCount: comCount }) => {
              if (comCount === 0) {
                res.status(404).json({
                  status: 'error',
                  error: 'Comment not found',
                });
              } else {
                db.query(`INSERT INTO 
                posts_and_comments_flags ("content_type", "content_id", "flag", "reason", "reporter") 
                VALUES ($1, $2, $3, $4, $5) RETURNING "reported_on", "report_id"`, [
                  'comment',
                  req.params.commentId,
                  req.body.flag,
                  req.body.reason,
                  req.loggedInUser.user_id,
                ]).then(({ rows: [{ reported_on: reportedOn, report_id: reportId }] }) => {
                  res.status(201).json({
                    status: 'success',
                    data: {
                      message: 'Report successfully created',
                      reportId,
                      contentType: 'comment',
                      contentId: parseInt(req.params.commentId, 10),
                      flag: req.body.flag,
                      reason: req.body.reason,
                      reportedOn,
                    },
                  });
                }).catch((error) => {
                  console.log(error);
                  res.status(500).json({
                    status: 'error',
                    error: 'Sorry, we couldn\'t complete your request please try again',
                  });
                });
              }
            }).catch((error) => {
              console.log(error);
              res.status(500).json({
                status: 'error',
                error: 'Sorry, we couldn\'t complete your request please try again',
              });
            });
        }
      }).catch((error) => {
        console.log(error);
        res.status(500).json({
          status: 'error',
          error: 'Sorry, we couldn\'t complete your request please try again',
        });
      });
  } else {
    res.status(400).json({
      status: 'error',
      error: report.error,
    });
  }
};

exports.delete = (req, res) => {
  // Verify that gif exists
  db.query(`
    SELECT post_author
    FROM posts 
    WHERE post_id = $1
    AND post_type = 'gif'
  `, [req.params.id]).then(({ rows, rowCount }) => {
    if (rowCount === 0) {
      // Gif does not exist
      res.status(404).json({
        status: 'error',
        error: 'Gif not found',
      });
    } else if (rows[0].post_author !== parseInt(req.loggedInUser.user_id, 10)) {
      // Gif is valid but does not belong to Current user
      res.status(401).json({
        status: 'error',
        error: 'Unauthorized to delete this gif',
      });
    } else {
      // Gif is valid and belongs to current user
      // Delete gif and gifs table and post_comment table will cascade
      db.query(`DELETE 
        FROM posts 
        WHERE post_id = $1
        AND post_author = $2
        AND post_type = $3`, [
        req.params.id,
        req.loggedInUser.user_id,
        'gif',
      ]).then(() => {
        res.status(200).json({
          status: 'success',
          data: {
            message: 'Gif successfully deleted',
          },
        });
      }).catch((error) => {
        console.log(error);
        res.status(500).json({
          status: 'error',
          error: 'Sorry, we couldn\'t complete your request please try again',
        });
      });
    }
  }).catch((error) => {
    console.log(error);
    res.status(500).json({
      status: 'error',
      error: 'Sorry, we couldn\'t complete your request please try again',
    });
  });
};
